// @ts-check
import {KubeConfig, ApiextensionsV1Api, ApisApi, AppsV1Api, AutoscalingV2Api, BatchV1Api, CoreV1Api, KubernetesObjectApi, V1APIResource} from '@kubernetes/client-node';
import { writeFile } from "node:fs/promises";

import { capitalize } from "./utils.js";

const clientRef =await import("@kubernetes/client-node")

const kc = new KubeConfig();
kc.loadFromDefault();

// console.log("k8s client ready!");
// const coreApi = kc.makeApiClient(CoreV1Api);
// const batchApi = kc.makeApiClient(BatchV1Api);
// const appsApi = kc.makeApiClient(AppsV1Api);
// const autoscalingApi = kc.makeApiClient(AutoscalingV2Api);


// Logic
// get all api-types

// Below call gives all built-in API and some custom API groups (except the "" default v1 group)
// but not the resource kinds belonging to those APIGroups... so we will need to make a Apiclient dynamically for each apigroup and list resource kinds
// For making dynamic call - we need to construct the Api ClassName e.g. BatchV1Api Dynamically
const apisApi = kc.makeApiClient(ApisApi)
const resp = await apisApi.getAPIVersions()
console.log(resp.body.groups);

// Prepare an array of ApiGroup names - which we can then make a dynamic client for later
/** @type Array<{apiName: string, apiVersion: string, resources?:{kind: string, namespaced:boolean, objects?: Array<import("@kubernetes/client-node").KubernetesObject>}[] }> */
const apis=[]
resp.body.groups.forEach(group => {
  // unfortunate reality - autoscaling/v2 has superceded autoscaling.k8s.io/v1 api. So we should skip adding autoscaling.k8s.io
  if(group.name !== "autoscaling.k8s.io"){
    group.versions.forEach(v => {
      if (v.version === group.preferredVersion?.version) {
        // if group.name has a domain name e.g. acme.cert-manager.io or autoscaling.k8s.io
        // then we, for now, should only process the one with k8s.io but we must drop that part when creating API name
        let process = false;
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
          }
        }else {
          process = true;
        }
        if (process) apis.push({apiName: `${capitalize(name)}${capitalize(v.version)}Api`, apiVersion: `${group.name}/${group.preferredVersion?.version}`})
      }
    })
  }
});
apis.push({apiName: "CoreV1Api", apiVersion: ""})
// console.log(JSON.stringify(apis, null, 2));

// Now that we have ApiGroups, below code gives us Resources for those apis
for await (const api of apis) {
  // console.log(`processing ${api.apiName}`);
  // It is possible some of the APIs under k8s.io are still CRDs. e.g. cluster.k8s.io and metrics.k8s.io so we will skip such apis for which we cannot make apiClient
  if(clientRef[api.apiName]) {
    const dynApi = kc.makeApiClient(clientRef[api.apiName])
    /** @type V1APIResource[]  */
    const resources = (await dynApi.getAPIResources()).body.resources
    // console.log(JSON.stringify(resources, null, 2))
    api.resources = resources.flatMap( res => { 
      if(res.kind === "Scale" || res.name.endsWith("/status") || res.name.endsWith("/proxy")|| res.name.endsWith("/attach")|| res.name.endsWith("/exec") || res.name.endsWith("/portforward") || !res.verbs.find(v=> v === "get")) {
        return [];
      }else return [{kind: res.kind, namespaced: res.namespaced}]
    })
  }
}
// console.log(JSON.stringify(apis, null, 2));

// const batchV1Api = kc.makeApiClient(clientRef["BatchV1Api"])
// console.log(JSON.stringify((await batchV1Api.getAPIResources()).body.resources, null, 2))

// TODO - also include Custom resources in the apigroup array above
// const apiextensionsApi = kc.makeApiClient(ApiextensionsV1Api)
// const resp = await apiextensionsApi.listCustomResourceDefinition()
// const resources = resp.body.items.map( item => { return {item: item.metadata?.name, scope: item.spec.scope, group: item.spec.group }})
// console.log(JSON.stringify(resources));

// We can make use of KubernetesObjectApi client to make generic list. It needs apitype and resource name and namespace as well!
// Specifically, maybe we do not want pods as they have dynamic namings.. but we are interested in all the v1 objects like 
// Deployments, Daemonsets, Statefulsets etc.
const k8sObjectApi = kc.makeApiClient(KubernetesObjectApi);
for await (const api of apis) {
  // console.log(`starting with api group ${api.apiName}`);
  if(api.resources && api.resources.length >0 ) {
    for await (const res of api.resources) {
      // console.log(`attempting to list ${JSON.stringify(api, null,2)}`);
      const k8sObjects = (await k8sObjectApi.list(api.apiVersion,res.kind)).body.items
      console.log(`got ${k8sObjects.length} resources for ${api.apiVersion} - ${res.kind}`);
      res.objects=k8sObjects;
    }
  }
}

await writeFile("./objects.json",JSON.stringify(apis,null,2));
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
