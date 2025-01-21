// @ts-check
import { log, error } from "console";
import nunjucks from "nunjucks";
import { readFile, writeFile, stat, mkdir } from "node:fs/promises";
import YAML from 'yaml'

const config = YAML.parse(await readFile('./generator-config.yaml', { encoding: 'utf8' }))
// log(config);

// FIXME: TEMP HARDCODED resources. EVentually this js functionality should be called directly from index.js
import apiObjects from "../objects.json" with { "type": "json" };
// import apiObjects from "../objects-smaller.json" with { "type": "json" };
// import apiObjects from "../objects-argodemo-seed.json" with { "type": "json" };
import { appendFile, rm, rmdir } from "fs/promises";
/** @type Array<{apiName: string, apiVersion: string, crd: boolean, resources?:{kind: string, namespaced:boolean, objects?: Array<import("@kubernetes/client-node").KubernetesObject>}[] }> */
const apis = apiObjects;

// log(`${apis.length}`)
nunjucks.configure('./templates', { autoescape: true });

// /** @type {{apiName: string, apiVersion: string, resources?:{kind: string, namespaced:boolean, objects?: Array<import("@kubernetes/client-node").KubernetesObject>}[] }} */
// const appsApi =  apis.find( api => api.apiVersion === "apps/v1")
// const deployments = (appsApi.resources?.find( res => res.kind === "Deployment"))?.objects
// let output = "";
// deployments?.forEach( depl => {
//   output+= nunjucks.render('deployment.yaml.njk', depl)
// })
// await writeFile("./output/00-deployments-assert.yaml",output);

// delete old generated content
await rm("./output", { recursive: true, force: true });

apis.forEach( api => {
  // work only with configured APIs
  // TODO: need logic to work with * and exclude scenarios
  const apiConfig = config.apiGroups.include.find(i => i.name === api.apiName)
  if(apiConfig) {
    // log(`api ${api.apiName} should be included.`)
    api.resources?.forEach(async res => {

      // work only with configured Resourcess
      // TODO: need logic to work with * and exclude scenarios
      const resConfig = apiConfig.resources?.include?.find(i => i === res.kind)
      let excludeConfig;
      // if no includes block then assume all to be picked and check for excludes block!
      if(! apiConfig.resources?.include) {
        excludeConfig = apiConfig.resources?.exclude?.find(i => i === res.kind)
        // if(excludeConfig) log(`Resource ${res.kind} should be excluded.`)
        // else log(`Resource ${res.kind} should be included.`)
      } else {
        // TODO: handle include + exclude scenarios? with RegEX it is possible
        // if include cofig is present then ignore exclude config
        excludeConfig = true;
      }
      if(resConfig || !excludeConfig) {
        // log(`Resource ${res.kind} should be included.`)
        // check if we have the nunjucks template for this type
        const tmplFile = `${api.apiName.split("V1Api")[0].toLowerCase()}/${res.kind.toLowerCase()}`;
        // log(tmplFile)
        try {
          log(`${api.apiName}\t${res.kind}\t${res.objects?.length}`)
          if(res.objects?.length !== 0) {
            await stat(`./templates/${tmplFile}.yaml.njk`)
            // log("template file exists")
            res.objects?.forEach( async obj => {
              // log(`res: ${obj.metadata?.namespace}\t${obj.metadata?.name}\t${res.kind}`)
              let ns = obj.metadata?.namespace? obj.metadata?.namespace: "__CLUSTER_LEVEL__";
              // We create directory for each namespace and further apitypes and resource and append test fixtures to 00-assert.yaml in it.
              await mkdir(`./output/${ns}/${tmplFile}`, {recursive: true});
              const output= nunjucks.render(`${tmplFile}.yaml.njk`, obj)
              if(output) await appendFile(`./output/${ns}/${tmplFile}/00-assert.yaml`,output);
            })
          }
          // await mkdir(`./output/${tmplFile}`, {recursive: true});
        } catch (err) {
            if(err.code === "ENOENT"){
              error(`template file ${err.path} does not exist. ${api.apiName} - ${res.kind}`)
            } else throw err;
        }
      }
    })
  }
})

log("All done!");
