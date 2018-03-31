# Spot: Instant cloud environments for developers

[![Travis](https://travis-ci.com/derekbekoe/vscode-spot.svg?token=ng6izydYD2zkXPDRE5DP&branch=dev)](https://travis-ci.com/derekbekoe/vscode-spot)

- VS Code Extension
    - Terminal, File Explorer, File Editing, Notifications, Status Bar
- Persistent File Storage
- Bring your own container
- Secure access over HTTPS
- In-browser access

![Spot VS Code extension commands](doc/assets/spot_screenshot1.png "Spot VS Code extension commands")
![Connected to spot](doc/assets/spot_screenshot2.png "Connected to spot")


## Commands

| Command | Description |
| --- |---|
| `Spot: Create`     | Create a new spot.
| `Spot: Connect`    | Connect to a spot using the spot name and token.
| `Spot: Disconnect` | Disconnect from a spot but keep it running.
| `Spot: Terminate`  | Terminate a spot.


## :grey_exclamation: ACI
Spot utilizes [Azure Container Instances](https://azure.microsoft.com/en-us/services/container-instances/).  
See [Container Instances pricing](https://azure.microsoft.com/en-us/pricing/details/container-instances/) for their pricing information.

:grey_exclamation: When you're done with a spot, save any files in persistent storage and **terminate** the spot.


## Quickstart

A few steps to get you started right away.

TODO


## Feedback

* Vote for [popular feature requests](https://github.com/derekbekoe/vscode-spot/issues?q=is%3Aopen+is%3Aissue+label%3Afeature-request+sort%3Areactions-%2B1-desc).
* File a bug in [GitHub Issues](https://github.com/derekbekoe/vscode-spot/issues).
* [Tweet](https://twitter.com/search?q=vscodespot) with hashtag #vscodespot with other feedback.


## Known limitations

- Intellisense & Debugging
    - Currently, there is no cross-file Intellisense or debugging
- Image pull time
    - The majority of spot startup time is the time it takes for Azure Container Instances to pull your requested image.
- Reliability / Resilience
    - Better handling of loss of connectivity is yet to come.


## Developer Setup

Looking to contribute or debug yourself?

1. Clone the repository
2. Open VS Code
3. Run `npm install`
4. Start the VS Code debugger to launch the extension


## Release History

See [GitHub Releases](https://github.com/derekbekoe/vscode-spot/releases).


## License
[MIT](LICENSE.md)
