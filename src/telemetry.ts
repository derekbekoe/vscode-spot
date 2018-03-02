import TelemetryReporter from 'vscode-extension-telemetry';
import { ExtensionContext } from 'vscode';

export function createTelemetryReporter(context: ExtensionContext) {
    const extensionPackage = require(context.asAbsolutePath('./package.json'));
    const reporter = new TelemetryReporter(extensionPackage.name, extensionPackage.version, extensionPackage.aiKey);
    context.subscriptions.push(reporter);
    return reporter;
}
