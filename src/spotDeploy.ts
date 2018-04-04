export var deploymentTemplate = {
    "$schema": "https://schema.management.azure.com/schemas/2015-01-01/deploymentTemplate.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {},
    "variables": {
      "spotName": "spot-1",
      "container1image": "ubuntu:xenial",
      "location": "westus",
      "instanceToken": "myToken",
      "container1name": "client",
      "container2image": "certbot/certbot",
      "container2name": "certbot",
      "certbotEmail": "git@github.com",
      "azureFileShareName1": "myFileShare",
      "azureStorageAccountName1": "myStorageAccountName",
      "azureStorageAccountKey1": "myStorageAccountKey",
      "azureFileShareName2": "myFileShare",
      "azureStorageAccountName2": "myStorageAccountName",
      "azureStorageAccountKey2": "myStorageAccountKey"
    },
    "resources": [
      {
        "name": "[variables('spotName')]",
        "type": "Microsoft.ContainerInstance/containerGroups",
        "apiVersion": "2018-02-01-preview",
        "location": "[variables('location')]",
        "properties": {
          "containers": [
            {
              "name": "[variables('container1name')]",
              "properties": {
                "image": "[variables('container1image')]",
                "command": [
                  "/bin/sh", "-c", "/.spot/spot-host-linux-0.1.9"
                ],
                "resources": {
                  "requests": {
                    "cpu": 1,
                    "memoryInGb": 1.5
                  }
                },
                "ports": [
                  {
                    "port": 80
                  },
                  {
                    "port": 443
                  },
                  {
                    "port": 5000
                  },
                  {
                    "port": 6006
                  },
                  {
                    "port": 8080
                  }
                ],
                "environmentVariables": [
                  {
                    "name": "PORT",
                    "value": "443"
                  },
                  {
                    "name": "USE_SSL",
                    "value": "1"
                  },
                  {
                    "name": "INSTANCE_TOKEN",
                    "value": "[variables('instanceToken')]"
                  },
                  {
                    "name": "C_DOMAIN",
                    "value": "[concat(variables('spotName'), '.', variables('location'), '.azurecontainer.io')]"
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
                  "/bin/sh", "-c", "/.spot/certbot_start.sh"
                ],
                "resources": {
                  "requests": {
                    "cpu": 1,
                    "memoryInGb": 1.5
                  }
                },
                "environmentVariables": [
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
                "protocol": "tcp",
                "port": "443"
              },
              {
                "protocol": "tcp",
                "port": "5000"
              },
              {
                "protocol": "tcp",
                "port": "80"
              },
              {
                "protocol": "tcp",
                "port": "6006"
              },
              {
                  "protocol": "tcp",
                  "port": "8080"
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