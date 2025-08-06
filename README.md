# k8s-test-generator


This repository provides a utility to inspect the existing cluster and generate barebones Chainsaw testcase for the resources as per your desire.

`generator-config.yaml` allows you to customize namespaces to include / exclude as well as resource group and resources that you want to include / exclude in the generated output.

## Getting started

```shell
# NOTE: You need to have need nodejs installed and kubeconfig exported to allow access to cluster

#install depenedencies
npm i

# edit `generator-config.yaml` to suit your needs

# run the program
npm start

# Verify the testcases
chainsaw tests output/default

```

## TODO
* - [x] Allow config file to configure - namepaces, apiGroups and resources filtering
* - [ ] Allow filtering by name regex
* - [x] secret template should include type
* - [x] If original secret did not have data / stringData block - we should not include that in the our output
* - [x] default exclude helm secrets as they are dynamic
* - [x] default exclude secrets of type `kubernetes.io/service-account-token` as they are dynamic and not user created
* - [x] Custom Resources
