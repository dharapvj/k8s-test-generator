

# TODO
* - [ ] Allow config file to configure - namepaces, apiGroups and resources filtering
* - [ ] Allow filtering by name regex
* - [x] secret template should include type
* - [x] If original secret did not have data / stringData block - we should not include that in the our output
* - [x] default exclude helm secrets as they are dynamic
* - [x] default exclude secrets of type `kubernetes.io/service-account-token` as they are dynamic and not user created
* - [ ] Custom Resources