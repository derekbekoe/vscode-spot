
import { OutputChannel, window } from 'vscode';

export class Logging {
    public static readonly ConsoleId = '[Spot]';
    public static outputChannel: any | undefined;

    public static configureOutputChannel() {
        this.outputChannel = this.outputChannel || window.createOutputChannel('Spot');
    }

    public static log(message?: any, ...params: any[]): void {
        console.log(this.timestamp, Logging.ConsoleId, message, ...params);
        if (this.outputChannel !== undefined) {
            this.outputChannel.appendLine([this.timestamp, message, ...params].join(' '));
        }
    }

    public static error(message?: any, ...params: any[]): void {
        console.error(this.timestamp, Logging.ConsoleId, message, ...params);
        if (this.outputChannel !== undefined) {
            this.outputChannel.appendLine([this.timestamp, 'Error:', message, ...params].join(' '));
        }
    }

    public static showOutputChannel() {
        if (this.outputChannel !== undefined) {
            this.outputChannel.show();
        }
    }

    private static get timestamp(): string {
        const dateNow = new Date().toISOString();
        return `[${dateNow}]`;
    }
}
