import { window, Extension, ExtensionContext, extensions, commands, StatusBarAlignment, StatusBarItem, MessageItem, workspace } from 'vscode';
import { TelemetryReporter, TelemetryResult } from './telemetry';
import opn = require('opn');
import { URL } from 'url';
import { AzureAccount, AzureSubscription } from './azure-account.api';
import { ResourceManagementClient } from 'azure-arm-resource';

import { createTelemetryReporter } from './telemetry';
import { SpotTreeDataProvider } from './spotTreeDataProvider';
import { SpotFileTracker, openFileEditor } from './spotFiles';
import { KnownSpots, SpotSession, SpotSetupError, UserCancelledError } from './spotUtil';
import { DEFAULT_RG_NAME } from './spotSetup';
import { spotCreate, ISpotCreationData, CreationHealthCheckError, SpotDeploymentError } from './spotCreate';
import { spotConnect, WindowsRequireNodeError } from './spotConnect';
import { spotDisconnect } from './spotDisconnect';
import { spotTerminate, MissingConfigVariablesError, ACIDeleteError } from './spotTerminate';

let reporter: TelemetryReporter;
let spotTreeDataProvider: SpotTreeDataProvider;
let statusBarItem: StatusBarItem;
let activeSession: SpotSession | null;
let spotFileTracker: SpotFileTracker;
let azureAccount: AzureAccount | undefined;
let knownSpots: KnownSpots;

export function activate(context: ExtensionContext) {
    reporter = createTelemetryReporter(context);
    statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left);
    context.subscriptions.push(statusBarItem);
    spotFileTracker = new SpotFileTracker();
    knownSpots = new KnownSpots();
    const azureAccountExtension: Extension<AzureAccount> | undefined = extensions.getExtension<AzureAccount>('ms-vscode.azure-account');
    azureAccount = azureAccountExtension ? azureAccountExtension.exports : undefined;
    spotTreeDataProvider = new SpotTreeDataProvider(spotFileTracker);
    window.registerTreeDataProvider('spotExplorer', spotTreeDataProvider);
    context.subscriptions.push(commands.registerCommand('spot.Create', cmdSpotCreate));
    context.subscriptions.push(commands.registerCommand('spot.Connect', cmdSpotConnect));
    context.subscriptions.push(commands.registerCommand('spot.Disconnect', cmdSpotDisconnect));
    context.subscriptions.push(commands.registerCommand('spot.Terminate', cmdSpotTerminate));
    context.subscriptions.push(commands.registerCommand('spot.OpenFileEditor', openFileEditor));
    context.subscriptions.push(commands.registerCommand('spot.OpenSpotInBrowser', openSpotInBrowser));
}

function openSpotInBrowser() {
    if (activeSession) {
        opn(activeSession.hostname + '?token=' + activeSession.token);
    }
}

function updateStatusBar(text: string) {
    statusBarItem.text = `Spot: ${text}`;
    if (activeSession) {
        statusBarItem.command = 'spot.OpenSpotInBrowser';
        statusBarItem.tooltip = 'Open spot in browser';
    } else {
        statusBarItem.command = undefined;
        statusBarItem.tooltip = undefined;
    }
    statusBarItem.show();
}

function getAzureSubscription(): AzureSubscription | undefined {
    if (!azureAccount) {
        window.showErrorMessage("The Azure Account Extension is required to create spots");
        return;
    }
    if (azureAccount.status !== 'LoggedIn') {
        window.showWarningMessage("Log in and try again.");
        commands.executeCommand("azure-account.login");
        return;
    }
    const candidateSubscriptions = azureAccount.filters.filter((sub: AzureSubscription) => {
        if (sub.subscription.id === undefined || sub.subscription.displayName === undefined || sub.subscription.subscriptionId === undefined || sub.subscription.state !== 'Enabled') {
            return false;
        }
        return true;
    });
    if (candidateSubscriptions.length !== 1) {
        window.showWarningMessage("Choose a single enabled Azure subscription and try again.");
        commands.executeCommand("azure-account.selectSubscriptions");
        return;
    }
    return candidateSubscriptions[0];
}


function cmdSpotCreate() {
    reporter.sendTelemetryEvent('onCommand/spotCreate');
    reporter.sendTelemetryEvent('spotCreate/initiate');
    const azureSub = getAzureSubscription();
    if (!azureSub) {
        reporter.sendTelemetryEvent('spotCreate/conclude',
                                    {'spot.result': TelemetryResult.USER_RECOVERABLE,
                                    'spot.reason': 'NO_AZURE_SUBSCRIPTION'});
        return;
    }
    spotCreate(azureSub)
    .then((res: ISpotCreationData) => {
        reporter.sendTelemetryEvent('spotCreate/conclude',
                                    {'spot.result': TelemetryResult.SUCCESS,
                                        'spot.detail.useSSL': String(res.useSSL),
                                        'spot.detail.imageName': res.imageName,
                                        'spot.detail.spotRegion': res.spotRegion});
        knownSpots.add(res.spotName, res.hostname, res.instanceToken);
        const connectItem: MessageItem = {title: 'Connect'};
        window.showInformationMessage('Spot created successfully', connectItem)
        .then((msgItem: MessageItem | undefined) => {
            if (msgItem === connectItem) {
                connectToSpot(res.hostname, res.instanceToken);
            }
        });
    })
    .catch((ex) => {
        if (ex instanceof UserCancelledError) {
            console.log('User cancelled spot create operation.');
            reporter.sendTelemetryEvent('spotCreate/conclude',
                        {'spot.result': TelemetryResult.USER_RECOVERABLE,
                        'spot.reason': 'USER_CANCELLED'});
        } else if (ex instanceof CreationHealthCheckError) {
            console.error('Spot health check failed', ex);
            reporter.sendTelemetryEvent('spotCreate/conclude',
                                        {'spot.result': TelemetryResult.ERROR,
                                            'spot.reason': 'HEALTH_CHECK_FAILURE',
                                            'spot.detail.useSSL': String(ex.spotCreationData.useSSL),
                                            'spot.detail.imageName': ex.spotCreationData.imageName,
                                            'spot.detail.spotRegion': ex.spotCreationData.spotRegion});
            const portalMsgItem: MessageItem = {title: 'Azure Portal'};
            window.showErrorMessage(`Spot health check failed for ${ex.spotCreationData.spotName}: Check the container logs in the Portal.`, portalMsgItem)
            .then((msgItem: MessageItem | undefined) => {
                if (portalMsgItem === msgItem) {
                    opn('https://portal.azure.com/#blade/HubsExtension/Resources/resourceType/Microsoft.ContainerInstance%2FcontainerGroups');
                }
            });
        } else if (ex instanceof SpotSetupError) {
            console.error(ex.message);
            const moreInfoItem: MessageItem = {title: 'More Info'};
            const portalMsgItem: MessageItem = {title: 'Azure Portal'};
            window.showErrorMessage(`Unable to complete the set up. ${ex.message}`, moreInfoItem, portalMsgItem).then((msgItem: MessageItem | undefined) => {
                if (msgItem === moreInfoItem) {
                    opn('https://github.com/derekbekoe/vscode-spot#configuration');
                } else if (msgItem === portalMsgItem) {
                    opn('https://portal.azure.com/');
                }
            }, (err: any) => {});
            reporter.sendTelemetryEvent('spotCreate/conclude',
                                        {'spot.result': TelemetryResult.USER_RECOVERABLE,
                                        'spot.reason': 'MISSING_CONFIGURATION_VARIABLES'});
            return;
        } else if (ex instanceof SpotDeploymentError) {
            console.error('Deployment failed', ex);
            window.showErrorMessage(`Unable to create spot: ${ex.message}`);
            reporter.sendTelemetryEvent('spotCreate/conclude',
                                            {'spot.result': TelemetryResult.ERROR,
                                                'spot.reason': 'DEPLOYMENT_FAILURE',
                                                'spot.detail.useSSL': String(ex.spotCreationData.useSSL),
                                                'spot.detail.imageName': ex.spotCreationData.imageName,
                                                'spot.detail.spotRegion': ex.spotCreationData.spotRegion});
        } else {
            console.error(ex.message);
        }
    });
}

function connectToSpot(hostname: string, instanceToken: string) {
    reporter.sendTelemetryEvent('spotConnect/initiate');
    spotConnect(hostname, instanceToken, spotFileTracker)
    .then((session: SpotSession) => {
        activeSession = session;
        commands.executeCommand('setContext', 'canShowSpotExplorer', true);
        window.showInformationMessage(`Connected to ${hostname}`);
        updateStatusBar(`${hostname} (connected)`);
        reporter.sendTelemetryEvent('spotConnect/conclude',
                                    {'spot.result': TelemetryResult.SUCCESS});
    })
    .catch((err: any) => {
        activeSession = null;
        commands.executeCommand('setContext', 'canShowSpotExplorer', false);
        window.showErrorMessage(`Failed to connect to ${hostname}`);
        updateStatusBar('Not connected');
        statusBarItem.show();
        if (err instanceof WindowsRequireNodeError) {
            reporter.sendTelemetryEvent('spotConnect/conclude',
                                {'spot.result': TelemetryResult.USER_RECOVERABLE,
                                'spot.reason': 'WINDOWS_REQUIRE_NODE'});
        } else {
            reporter.sendTelemetryEvent('spotConnect/conclude',
                                        {'spot.result': TelemetryResult.ERROR,
                                        'spot.reason': 'HEALTH_CHECK_FAILURE'});
        }
    });
}

function cmdSpotConnect() {
    reporter.sendTelemetryEvent('onCommand/spotConnect');
    const spotNamePrompt = Object.keys(knownSpots.getAll()).length > 0 ? `Known spots: ${Array.from(Object.keys(knownSpots.getAll()))}` : undefined;
    window.showInputBox({placeHolder: 'Spot to connect to.', ignoreFocusOut: true, prompt: spotNamePrompt}).then((spotName) => {
        if (!spotName) {
            return;
        }
        if (knownSpots.isKnown(spotName)) {
            const spot = knownSpots.get(spotName);
            connectToSpot(spot.hostname, spot.instanceToken);
        } else {
            if (spotName.indexOf('azurecontainer.io') > -1 && spotName.indexOf('?token=') > -1) {
                // If full URL provided, no need to ask for token
                const spotURL = new URL(spotName);
                const spotPort = spotURL.protocol.startsWith('https') ? '443' : '80';
                var spotToken = spotName.substring(spotName.indexOf('?token=') + '?token='.length);
                spotName = `${spotURL.origin}:${spotPort}`;
                connectToSpot(spotName, spotToken);
                return;
            }
            window.showInputBox({placeHolder: 'Token for the spot.', password: true, ignoreFocusOut: true}).then((spotToken) => {
                if (spotToken) {
                    connectToSpot(spotName!, spotToken);
                }
            });
        }
    });
}

function cmdSpotDisconnect() {
    reporter.sendTelemetryEvent('onCommand/spotDisconnect');
    disconnectFromSpot();
}

function disconnectFromSpot() {
    reporter.sendTelemetryEvent('spotDisconnect/initiate');
    spotDisconnect(activeSession, spotFileTracker)
    .then(() => {
        activeSession = null;
        updateStatusBar('Not connected');
        reporter.sendTelemetryEvent('spotDisconnect/conclude', {'spot.result': TelemetryResult.SUCCESS});
    })
    .catch((err: any) => {
        console.error(err);
    });
}

function cmdSpotTerminate() {
    reporter.sendTelemetryEvent('onCommand/spotTerminate');
    if (activeSession != null) {
        const disConnectMsgItem: MessageItem = {title: 'Disconnect'};
        window.showWarningMessage('Disconnect from the current spot before terminating a spot.', disConnectMsgItem)
        .then((msgItem: MessageItem | undefined) => {
            if (disConnectMsgItem === msgItem) {
                disconnectFromSpot();
            }
        });
    } else {
        terminateSpot();
    }
}

function terminateSpot() {
    reporter.sendTelemetryEvent('spotTerminate/initiate');
    const azureSub = getAzureSubscription();
    if (!azureSub) {
        reporter.sendTelemetryEvent('spotTerminate/conclude',
                                    {'spot.result': TelemetryResult.USER_RECOVERABLE,
                                     'spot.reason': 'NO_AZURE_SUBSCRIPTION'});
        return;
    }
    spotTerminate(azureSub, knownSpots)
    .then(() => {
        reporter.sendTelemetryEvent('spotTerminate/conclude', {'spot.result': TelemetryResult.SUCCESS});
    })
    .catch((ex: any) => {
        if (ex instanceof UserCancelledError) {
            console.log('User cancelled spot delete operation.', ex.message);
            reporter.sendTelemetryEvent('spotTerminate/conclude',
                        {'spot.result': TelemetryResult.USER_RECOVERABLE,
                        'spot.reason': 'USER_CANCELLED'});
        } else if (ex instanceof MissingConfigVariablesError) {
            reporter.sendTelemetryEvent('spotTerminate/conclude',
                                    {'spot.result': TelemetryResult.USER_RECOVERABLE,
                                    'spot.reason': 'MISSING_CONFIGURATION_VARIABLES'});
        } else if (ex instanceof ACIDeleteError) {
            const portalMsgItem: MessageItem = {title: 'Azure Portal'};
            reporter.sendTelemetryEvent('spotTerminate/conclude',
                    {'spot.result': TelemetryResult.USER_RECOVERABLE,
                        'spot.reason': 'ARM_RESOURCE_DELETE_FAILURE'});
            window.showErrorMessage('Unable to terminate spot. Open the Azure portal and delete the container group from there.', portalMsgItem)
            .then((msgItem: MessageItem | undefined) => {
                if (portalMsgItem === msgItem) {
                    opn('https://portal.azure.com/#blade/HubsExtension/Resources/resourceType/Microsoft.ContainerInstance%2FcontainerGroups');
                }
            });
        } else {
            console.error(ex.message);
        }
    });
}

export function deactivate() {
    reporter.dispose();
}
