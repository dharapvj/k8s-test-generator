// @ts-check
import {KubeConfig, ApiextensionsV1Api, ApisApi, AppsV1Api, AutoscalingV2Api, BatchV1Api, CoreV1Api, KubernetesObjectApi, V1APIResource, CustomObjectsApi} from '@kubernetes/client-node';
import { readFile, writeFile } from "node:fs/promises";
import YAML from 'yaml'

import { capitalize } from "./utils.js";
import { generate } from "./test-generator.js";

const clientRef =await import("@kubernetes/client-node")


const config = YAML.parse(await readFile('./generator-config.yaml', { encoding: 'utf8' }))
// log(config);

const kc = new KubeConfig();
kc.loadFromDefault();


// Logic
// get all api-types

// Below call gives all built-in API and some custom API groups (except the "" default v1 group)
// but not the resource kinds belonging to those APIGroups... so we will need to make a Apiclient dynamically for each apigroup and list resource kinds
// For making dynamic call - we need to construct the Api ClassName e.g. BatchV1Api Dynamically
const apisApi = kc.makeApiClient(ApisApi)
const resp = await apisApi.getAPIVersions()
// console.log(resp.body.groups);

// Prepare an array of ApiGroup names - which we can then make a dynamic client for later
/** @type Array<{apiName: string, apiVersion: string, crd: boolean, resources?:{kind: string, namespaced:boolean, objects?: Array<import("@kubernetes/client-node").KubernetesObject>}[] }> */
const apis=[]
resp.groups.forEach(group => {
  // unfortunate reality - autoscaling/v2 has superceded autoscaling.k8s.io/v1 api. So we should skip adding autoscaling.k8s.io
  if(group.name !== "autoscaling.k8s.io"){
    group.versions.forEach(v => {
      if (v.version === group.preferredVersion?.version) {
        // if group.name has a domain name e.g. acme.cert-manager.io or autoscaling.k8s.io
        // then we, for now, should only process the one with k8s.io but we must drop that part when creating API name
        let process = false, crd = false;
        let name = group.name;
        if(name.includes(".")) {
          if(name.includes(".k8s.io")){
            process = true;
            name = name.substring(0, name.indexOf(".k8s.io"))
            // sometimes we have more subdomanis - we need to merge and capitalize them in name
            // e.g. flowcontrol.apiserver.k8s.io ==> FlowcontrolApiserverV1Api
            let dotIdx = name.indexOf(".")
            if(dotIdx > -1) {
              const char = name.charAt(dotIdx+1).toUpperCase()
              name = name.substring(0, dotIdx+1) + char + name.substring(dotIdx+1 + 1);
              name = name.replace(".","")
            }
          } else {
            // Process custom resources
            // console.log(JSON.stringify(group, null, 2));
            process = true;
            crd = true;
          }
        }else {
          process = true;
        }
        if (process && ! crd) {
          apis.push({crd, apiName: `${capitalize(name)}${capitalize(v.version)}Api`, apiVersion: `${group.name}/${group.preferredVersion?.version}`})
        } else if( process && crd ){
          apis.push({crd, apiName: group.name, apiVersion: v.version})
        } // NOOP if ! process
      }
    })
  }
});
apis.push({apiName: "CoreV1Api", apiVersion: "", crd: false})
// console.log(JSON.stringify(apis, null, 2));

// Now that we have ApiGroups, below code gives us Resources for those apis
for await (const api of apis) {
  // console.log(`processing ${api.apiName}`);
  // It is possible some of the APIs under k8s.io are still CRDs. e.g. cluster.k8s.io and metrics.k8s.io so we will skip such apis for which we cannot make apiClient
  if(clientRef[api.apiName]) {
    const dynApi = kc.makeApiClient(clientRef[api.apiName])
    /** @type V1APIResource[]  */
    const resources = (await dynApi.getAPIResources()).resources
    // console.log(JSON.stringify(resources, null, 2))
    api.resources = resources.flatMap( res => { 
      if(res.kind === "Scale" || res.name.endsWith("/status") || res.name.endsWith("/proxy")|| res.name.endsWith("/attach")|| res.name.endsWith("/exec") || res.name.endsWith("/portforward") || !res.verbs.find(v=> v === "get")) {
        return [];
      }else return [{kind: res.kind, namespaced: res.namespaced}]
    })
  }
}
// console.log(JSON.stringify(apis, null, 2));

// also include Custom resources in the apigroup array above
const apiextensionsApi = kc.makeApiClient(ApiextensionsV1Api)
const crds = await apiextensionsApi.listCustomResourceDefinition()
const resources = crds.items.map( item => { return {apiVersion: item.status?.storedVersions[0], item: item.metadata?.name, scope: item.spec.scope, group: item.spec.group }})
resources.forEach(res => {
  const api = {};
    // console.log(JSON.stringify(res, null, 2));
    // find corresponding api in `apis` list and populate resources block
    const crapi = apis.find(api => api.apiName === res.group && api.apiVersion === res.apiVersion);
    if (crapi) {
      if( ! crapi?.resources) crapi.resources = [];
      let kind = res.item?.substring(0,res.item.indexOf(res.group)-1)
      if(!kind) kind ="ERROR"
      crapi.resources.push( {namespaced: res.scope === "Namespaced", kind: kind})
    }
});
// console.log(JSON.stringify(apis, null, 2));


// We can make use of KubernetesObjectApi client to make generic list. It needs apitype and resource name and namespace as well!
// Specifically, maybe we do not want pods as they have dynamic namings.. but we are interested in all the v1 objects like 
// Deployments, Daemonsets, Statefulsets etc.
const crApi = kc.makeApiClient(CustomObjectsApi);
const k8sObjectApi = kc.makeApiClient(KubernetesObjectApi);
for await (const api of apis) {
  console.log(`starting with api group ${api.apiName}`);
  if(api.resources && api.resources.length >0 ) {
    for await (const res of api.resources) {
      // console.log(`attempting to list ${JSON.stringify(api, null,2)}`);
      let k8sObjects = [];
      if(! api.crd){
        console.log(api.apiName,"\t\t",api.apiVersion,"\t\t", res.kind)

        const apiConfig = config.apiGroups.include.find(i => i.name === api.apiName)
        let processResource = false;
        if(! apiConfig) continue;
        
        // if no includes block as well as excludes block then assume all to be picked!
        if(! apiConfig?.resources?.include && ! apiConfig?.resources?.exclude) {
          // get list of the resourcetype
          processResource = true;
        } else {
          // find if the resource was included OR was not excluded.
          // console.log(JSON.stringify(apiConfig, null, 2));
          // console.log(JSON.stringify(res));
          
          const isResIncluded = apiConfig.resources?.include?.find(i => i === res.kind)
          const isResExcluded = apiConfig.resources?.exclude?.find(i => i === res.kind);
          const isIncludeBlock = apiConfig.resources?.include ? true : false;
          // console.log(isResIncluded, isResExcluded);
          
          // exclusion has more priority over inclusion. so skip processing for all excluded resources.
          // if there is no include block and resource is not excluded then we should include it!
          if (! isIncludeBlock && ! isResExcluded) {
            processResource = true;
          } else if ( ! isResExcluded && ! isResIncluded ) {
            processResource = false;
          } else if ( isResIncluded) {
            processResource = true;
          } else {
            console.log(`Resource ${res.kind} was not queried since it was excluded in configuration.`);
          }
        }
    
        if( processResource) {
          if(config.namespaces.include && config.namespaces.include.length > 0) {
            for(const ns of config.namespaces.include) {
              const nsObjects = (await k8sObjectApi.list(api.apiVersion, res.kind, ns)).items;
              console.log(`got ${nsObjects?.length} resources for ${api.apiVersion} - ${res.kind} in namespace ${ns}`);
              k8sObjects.push(...nsObjects);
            }
          } else {
            // if no namespaces are configured then we list resources for all namespaces
            const nsObjects = (await k8sObjectApi.list(api.apiVersion, res.kind)).items;
            console.log(`got ${nsObjects?.length} resources for ${api.apiVersion} - ${res.kind}`);
            k8sObjects.push(...nsObjects);
          }
        }
        // TODO: when there no apiGroups in configuration. Get all!
        // TODO: when there are no speficic resource types in configuration. Get all!
      } else {
        const apiConfig = config.apiGroups.include.find(i => i.name === api.apiName)
        let processResource = false;
    
        // if no includes block as well as excludes block then assume all to be picked!
        if(! apiConfig?.resources?.include && ! apiConfig?.resources?.exclude) {
          // get list of the resourcetype
          processResource = false;
        } else {
          // find if the resource was included OR was not excluded.
          // console.log(JSON.stringify(apiConfig, null, 2));
          // console.log(JSON.stringify(res));
          
          const isResIncluded = apiConfig.resources?.include?.find(i => i === res.kind)
          const isResExcluded = apiConfig.resources?.exclude?.find(i => i === res.kind);
          const isIncludeBlock = apiConfig.resources?.include ? true : false;
          console.log(isResIncluded, isResExcluded);
          
          // exclusion has more priority over inclusion. so skip processing for all excluded resources.
          // if there is no include block and resource is not excluded then we should include it!
          if (! isIncludeBlock && ! isResExcluded) {
            processResource = true;
          } else if ( ! isResExcluded && ! isResIncluded ) {
            processResource = false;
          } else if ( isResIncluded) {
            processResource = true;
          } else {
            console.log(`Resource ${res.kind} was not queried since it was excluded in configuration.`);
          }
        }
        if( processResource) {
          const group = api.apiName, version = api.apiVersion, plural = res.kind;
          console.log(group,"\t\t",version, "\t\t", plural);
          if(res.namespaced ) {
            if(config.namespaces.include && config.namespaces.include.length > 0) {
              for(const ns of config.namespaces.include) {
                const nsObjects = (await crApi.listClusterCustomObject({group, version, plural, fieldSelector: `metadata.namespace=${ns}`})).items;
                console.log(`got ${nsObjects?.length} resources for ${group}/${version} - ${plural} in ${ns} namespace`);
                k8sObjects.push(...nsObjects);
              }
            } else {
              let objects = (await crApi.listClusterCustomObject({group, version, plural})).items;
              console.log(`got ${objects?.length} resources for ${group}/${version} - ${plural}`);
              k8sObjects.push(...objects);
            }
          } else {
            let objects = (await crApi.listClusterCustomObject({group, version, plural})).items;
            console.log(`got ${objects?.length} resources for ${group}/${version} - ${plural}`);
            k8sObjects.push(...objects);
          }
        }
      }
      k8sObjects.forEach(o => {
        delete o.metadata?.managedFields
        if(o.metadata?.annotations && o.metadata.annotations["kubectl.kubernetes.io/last-applied-configuration"]) {
          delete o.metadata.annotations["kubectl.kubernetes.io/last-applied-configuration"]
        }
      });

      res.objects=k8sObjects;
    }
  }
}

console.log("Got details of the resources from the cluster!");
// await writeFile("./objects.json",JSON.stringify(apis,null,2));
await generate(apis)
console.log("All done!");

// const pods = (await k8sObjectApi.list("","Pod")).body.items
// console.log(JSON.stringify(pods.map( pod => {return {name: pod.metadata?.name, namespace: pod.metadata?.namespace}}),null,2));

// // 
// const clusterRoles = (await k8sObjectApi.list("rbac.authorization.k8s.io/v1", "ClusterRole")).body.items
// console.log(JSON.stringify(clusterRoles.map( cr => {return {name: cr.metadata?.name}}),null, 2));


// const api_resources = []
// for (const api_group in apis)
//   api_resources.push(extractClusterScopedResources(api_group))

// for each api-type - get all resources
// for each resource use Nunjucks template to create chainsaw testcase?