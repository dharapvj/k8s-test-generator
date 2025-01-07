// @ts-check
import { log, error } from "console";
import nunjucks from "nunjucks";
import { readFile, writeFile, stat, mkdir } from "node:fs/promises";
import YAML from 'yaml'

const config = YAML.parse(await readFile('./generator-config.yaml', { encoding: 'utf8' }))
// log(config);

// FIXME: TEMP HARDCODED resources
import apiObjects from "../objects-smaller.json" with { "type": "json" };
/** @type Array<{apiName: string, apiVersion: string, resources?:{kind: string, namespaced:boolean, objects?: Array<import("@kubernetes/client-node").KubernetesObject>}[] }> */
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
      if(resConfig) {
        // log(`Resource ${res.kind} should be included.`)
        // check if we have the nunjucks template for this type
        const tmplFile = `./templates/${res.kind.toLowerCase()}.yaml.njk`;
        try {
          log(`${api.apiName}\t${res.kind}\t${res.objects?.length}`)
          await stat(tmplFile)
          // log("template file exists")
          let output = "";
          res.objects?.forEach( obj => {
            output+= nunjucks.render(`${res.kind.toLowerCase()}.yaml.njk`, obj)
          })
          await mkdir(`./output/${res.kind.toLowerCase()}`, {recursive: true});
          await writeFile(`./output/${res.kind.toLowerCase()}/00-assert.yaml`,output);
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
