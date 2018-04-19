export var deploymentTemplate = {
    "$schema": "https://schema.management.azure.com/schemas/2015-01-01/deploymentTemplate.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {},
    "variables": {
      "spotName": "spotName",
      "container1image": "imageName",
      "instanceToken": "myToken",
      "location": "westus",
      "useSSL": "1",
      "container1name": "client",
      "container1port": "443",
      "container2image": "certbot/certbot",
      "container2name": "certbot",
      "certbotEmail": "vscodespot@derekbekoe.com",
      "azureFileShareName1": "",
      "azureStorageAccountName1": "",
      "azureStorageAccountKey1": "",
      "azureFileShareName2": "",
      "azureStorageAccountName2": "",
      "azureStorageAccountKey2": "",
      "fileWatcherWatchPath": ""
    },
    "resources": [
      {
        "name": "[variables('spotName')]",
        "type": "Microsoft.ContainerInstance/containerGroups",
        "apiVersion": "2018-04-01",
        "location": "[variables('location')]",
        "tags": {
            "isSpot": "true"
        },
        "properties": {
          "containers": [
            {
              "name": "[variables('container1name')]",
              "properties": {
                "image": "[variables('container1image')]",
                "command": [
                  "/bin/sh", "-c", "/.spot/spot-host"
                ],
                "resources": {
                  "requests": {
                    "cpu": 1,
                    "memoryInGb": 1.5
                  }
                },
                "ports": [
                  {
                    "protocol": "TCP",
                    "port": 80
                  },
                  {
                    "protocol": "TCP",
                    "port": 443
                  },
                  {
                    "protocol": "TCP",
                    "port": 5001
                  },
                  {
                    "protocol": "TCP",
                    "port": 5002
                  },
                  {
                    "protocol": "TCP",
                    "port": 5003
                  }
                ],
                "environmentVariables": [
                  {
                    "name": "PORT",
                    "value": "[variables('container1port')]"
                  },
                  {
                    "name": "DEBUG",
                    "value": "http,mail,express:*"
                  },
                  {
                    "name": "USE_SSL",
                    "value": "[variables('useSSL')]"
                  },
                  {
                    "name": "INSTANCE_TOKEN",
                    "value": "[variables('instanceToken')]"
                  },
                  {
                    "name": "C_DOMAIN",
                    "value": "[concat(variables('spotName'), '.', variables('location'), '.azurecontainer.io')]"
                  },
                  {
                    "name": "SPOT_FILE_WATCH_PATH",
                    "value": "[variables('fileWatcherWatchPath')]"
                  }
                ],
                "volumeMounts": [
                  {
                    "name": "spot-host-mount",
                    "mountPath": "/.spot",
                    "readOnly": true
                  },
                  {
                    "name": "user-files",
                    "mountPath": "/root/persistent",
                    "readOnly": false
                  },
                  {
                    "name": "certbot-dir",
                    "mountPath": "/.certbot"
                  },
                  {
                    "name": "letsencrypt-dir",
                    "mountPath": "/etc/letsencrypt"
                  }
                ]
              }
            },
            {
              "name": "[variables('container2name')]",
              "properties": {
                "image": "[variables('container2image')]",
                "command": [
                  "/bin/sh", "-c", "/.spot/certbot.sh"
                ],
                "resources": {
                  "requests": {
                    "cpu": 1,
                    "memoryInGb": 1.5
                  }
                },
                "environmentVariables": [
                  {
                    "name": "USE_SSL",
                    "value": "[variables('useSSL')]"
                  },
                  {
                    "name": "C_DOMAIN",
                    "value": "[concat(variables('spotName'), '.', variables('location'), '.azurecontainer.io')]"
                  },
                  {
                    "name": "C_EMAIL",
                    "value": "[variables('certbotEmail')]"
                  }
                ],
                "volumeMounts": [
                  {
                    "name": "spot-host-mount",
                    "mountPath": "/.spot",
                    "readOnly": true
                  },
                  {
                    "name": "certbot-dir",
                    "mountPath": "/.certbot"
                  },
                  {
                    "name": "letsencrypt-dir",
                    "mountPath": "/etc/letsencrypt"
                  }
                ]
              }
            }
          ],
          "osType": "Linux",
          "restartPolicy": "Never",
          "ipAddress": {
            "type": "Public",
            "dnsNameLabel": "[variables('spotName')]",
            "ports": [
              {
                "protocol": "TCP",
                "port": 80
              },
              {
                "protocol": "TCP",
                "port": 443
              },
              {
                "protocol": "TCP",
                "port": 5001
              },
              {
                "protocol": "TCP",
                "port": 5002
              },
              {
                "protocol": "TCP",
                "port": 5003
              }
            ]
          },
          "volumes": [
            {
              "name": "spot-host-mount",
              "azureFile": {
                "shareName": "[variables('azureFileShareName1')]",
                "readOnly": true,
                "storageAccountName": "[variables('azureStorageAccountName1')]",
                "storageAccountKey": "[variables('azureStorageAccountKey1')]"
              }
            },
            {
              "name": "user-files",
              "azureFile": {
                "shareName": "[variables('azureFileShareName2')]",
                "readOnly": false,
                "storageAccountName": "[variables('azureStorageAccountName2')]",
                "storageAccountKey": "[variables('azureStorageAccountKey2')]"
              }
            },
            {
              "name": "certbot-dir",
              "emptyDir": {}
            },
            {
              "name": "letsencrypt-dir",
              "emptyDir": {}
            }
          ]
        }
      }
    ],
    "outputs": {
      "containerIPv4Address": {
        "type": "string",
        "value": "[reference(resourceId('Microsoft.ContainerInstance/containerGroups/', variables('spotName'))).ipAddress.ip]"
      }
    }
  };