# Spot: Instant cloud environments for developers

[![Travis](https://travis-ci.com/derekbekoe/vscode-spot.svg?token=ng6izydYD2zkXPDRE5DP&branch=dev)](https://travis-ci.com/derekbekoe/vscode-spot)

Developer tools are becoming more cloud powered. Scaling beyond what the user’s machine can provide is an awesome opportunity to do amazing things. Spot is a VS Code extension that provides an integrated terminal, file explorer and editor to any container image with terminal access through the browser also.

- VS Code Extension
    - Terminal, File Explorer, File Editing, Notifications, Status Bar
- Persistent File Storage
- Bring your own container
- Secure access over HTTPS
- In-browser access

![Spot VS Code extension commands](doc/assets/spot_screenshot1.png "Spot VS Code extension commands")
![Connected to spot](doc/assets/spot_screenshot2.png "Connected to spot")
![Access spot from browser](doc/assets/spot_screenshot3.png "Access spot from browser")


## Commands

| Command | Description |
| --- |---|
| `Spot: Create`     | Create a new spot.
| `Spot: Connect`    | Connect to a spot using the spot name and token.
| `Spot: Disconnect` | Disconnect from a spot but keep it running.
| `Spot: Terminate`  | Terminate a spot.


## Quickstart

A few steps to get you started right away.

#### Azure File Share

Set up an Azure File Share with the following files at the root of the file share:  
    - https://vscodespot.blob.core.windows.net/preview/spot-host  
    - https://vscodespot.blob.core.windows.net/preview/pty.node  
    - https://vscodespot.blob.core.windows.net/preview/certbot.sh  

#### Configuration

| Name | Description |
| --- |---|
| `spot.azureResourceGroup`     | The resource group to deploy spots into.
| `spot.azureStorageAccountName`    | The storage account name containing the file share.
| `spot.azureStorageAccountKey` | The storage account key for the storage account.
| `spot.azureFileShareName1`  | The file share name containing the spot host.
| `spot.azureFileShareName2`  | (optional) The file share name you want to mount for persistent storage.
| `spot.createSpotWithSSLEnabled`  | (optional) Create new spots with SSL enabled. Disable this if you are having issues with Let's Encrypt.

See [User and Workspace Settings](https://code.visualstudio.com/docs/getstarted/settings) on how to set these configuration values in VS Code.

#### Log in to Azure

If not already logged in, log in to Azure inside VS Code with `Azure: Log In`.
Use `Azure: Select Subscriptions` to select an appropriate subscription.

#### Create a Spot

Create a Spot with `Spot: Create`.

When done, `Spot: Disconnect` and then `Spot: Terminate` to shut down the instance.

:exclamation: Spot utilizes [Azure Container Instances](https://azure.microsoft.com/en-us/services/container-instances/). See [Container Instances pricing](https://azure.microsoft.com/en-us/pricing/details/container-instances/) for their pricing information.

:warning: When you're done with a spot, save any files in persistent storage and **terminate** the spot.

#### Ports

Inside a running spot, the following ports are available to you: 5001, 5002, 5003.


## Feedback

* Vote for [popular feature requests](https://github.com/derekbekoe/vscode-spot/issues?q=is%3Aopen+is%3Aissue+label%3Aenhancement+sort%3Areactions-%2B1-desc).
* File a bug in [GitHub Issues](https://github.com/derekbekoe/vscode-spot/issues).
* Tweet with hashtag [#vscodespot](https://twitter.com/search?q=vscodespot) with other feedback.


## Known Limitations

- VS Code Extension only supports Linux/macOS
    - Currently, the extension will not run correctly on Windows.
- Intellisense & Debugging
    - Currently, there is no cross-file Intellisense or debugging
- Image pull time
    - Large container images can take a couple minutes to start.
- Reliability / Resilience
    - Better handling of loss of connectivity is yet to come.
- Only Linux containers are supported
    - We hope to lift this limitation in the future.

## Developer Setup

Looking to contribute or debug yourself?

1. Clone the repository
2. Open VS Code
3. Run `npm install`
4. Start the VS Code debugger to launch the extension

### Packaging
`npm run compile`

`./node_modules/.bin/vsce package`


## Release History

See [GitHub Releases](https://github.com/derekbekoe/vscode-spot/releases).


## License
[MIT](LICENSE.md)
