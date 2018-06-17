# Spot: Instant cloud environments for developers

Developer tools are becoming more cloud powered. Spot is a VS Code extension that provides an integrated terminal, file explorer and editor to any host running [the Spot Host](https://github.com/derekbekoe/spot) with terminal access through the browser also.

- VS Code Extension
    - Terminal, File Explorer, File Editing, Notifications, Status Bar
- Persistent File Storage
- Bring your own container
- Secure access over HTTPS
- In-browser access

![Spot VS Code extension commands](doc/assets/spot_screenshot1.png "Spot VS Code extension commands")
![Connected to spot](doc/assets/spot_screenshot2.png "Connected to spot")
![Access spot from browser](doc/assets/spot_screenshot3.png "Access spot from browser")

## Announcements
- [Spot: Instant cloud environments for developers](https://blog.derekbekoe.com/announcing-spot/)
- [Spot: June Update (0.4)](https://blog.derekbekoe.com/spot-june-update/)

## Getting started

A few steps to get you started right away:

Log in to Azure:  
`Azure: Log In`

Choose a single subscription:  
`Azure: Select Subscriptions`  

Create a spot:  
`Spot: Create`

When done, disconnect:  
`Spot: Disconnect`.

Use `Spot: Terminate` to shut down the instance.

NOTE: Spot utilizes [Azure Container Instances](https://azure.microsoft.com/en-us/services/container-instances/). See [Container Instances pricing](https://azure.microsoft.com/en-us/pricing/details/container-instances/) for their pricing information.

NOTE: When you're done with a spot, save any files in persistent storage and **terminate** the spot.


## Commands

| Command | Description |
| --- |---|
| `Spot: Create`     | Create a new spot.
| `Spot: Connect`    | Connect to a spot using the spot name and token.
| `Spot: Disconnect` | Disconnect from a spot but keep it running.
| `Spot: Terminate`  | Terminate a spot.


## Ports

Inside a running spot, the following ports are available to you: 5001, 5002, 5003.


## Known Limitations

- Cannot create Spots with Alpine-based images
    - The Spot host is not yet available for Alpine-based images
    - See [Build spot host with support for Alpine](https://github.com/derekbekoe/spot/issues/6)
- Intellisense & Debugging
    - Currently, there is no cross-file Intellisense or debugging


## Debugging Tips

- Check the deployment logs in the Portal. A possible error is that spot name (DNS name) is already taken.
- Check the ACI logs for each container.


## Manual Set Up

This is typically not required and is for advanced usage.

#### Azure File Share

Set up an Azure File Share with the following files at the root of the file share:  
    - https://github.com/derekbekoe/spot/releases/download/v0.2.0/spot-host  
    - https://github.com/derekbekoe/spot/releases/download/v0.2.0/pty.node  
    - https://github.com/derekbekoe/spot/releases/download/v0.2.0/certbot.sh  

#### Configuration

All configuration options below are optional and should only be used for advanced usage.

| Name | Description |
| --- |---|
| `spot.azureResourceGroup`     | The resource group to deploy spots into.
| `spot.azureStorageAccountName`    | The storage account name containing the file share.
| `spot.azureStorageAccountKey` | The storage account key for the storage account.
| `spot.azureFileShareName1`  | The file share name containing the spot host.
| `spot.azureRegion` | (optional) The region to deploy spots into. See [region availability](https://docs.microsoft.com/en-us/azure/container-instances/container-instances-quotas#region-availability).
| `spot.azureFileShareName2`  | The file share name you want to mount for persistent storage.
| `spot.createSpotWithSSLEnabled`  | Create new spots with SSL enabled. This is experimental. Disable this if you are having issues with Let's Encrypt.

See [User and Workspace Settings](https://code.visualstudio.com/docs/getstarted/settings) on how to set these configuration values in VS Code.


## Feedback

* Vote for [popular feature requests](https://github.com/derekbekoe/vscode-spot/issues?q=is%3Aopen+is%3Aissue+label%3Aenhancement+sort%3Areactions-%2B1-desc).
* File a bug in [GitHub Issues](https://github.com/derekbekoe/vscode-spot/issues).
* Tweet with hashtag [#vscodespot](https://twitter.com/search?q=vscodespot) with other feedback.


## Developer Setup

Looking to contribute or debug yourself?

1. Clone the repository
2. Open VS Code
3. Run `npm install`
4. Start the VS Code debugger to launch the extension

### Packaging
Compile TS: `npm run compile`  
Build package: `./node_modules/.bin/vsce package`  
Publish extension: `./node_modules/.bin/vsce publish -p TOKEN`  

## Release History
See [GitHub Releases](https://github.com/derekbekoe/vscode-spot/releases).

## License
[MIT](LICENSE.md)
