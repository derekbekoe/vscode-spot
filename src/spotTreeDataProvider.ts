import * as vscode from "vscode";
import { URL } from 'url';
import * as WS from 'ws';

import { SpotSession } from './session';

export enum TNodeKind { NODE_FILE, NODE_FOLDER };


export class SpotTreeDataProvider implements vscode.TreeDataProvider<TNode> {

  private _onDidChangeTreeData: vscode.EventEmitter<TNode | undefined> = new vscode.EventEmitter<TNode | undefined>();
  readonly onDidChangeTreeData: vscode.Event<TNode | undefined> = this._onDidChangeTreeData.event;
  private ws: WS | undefined;

  constructor() {}

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  public connect(session: SpotSession) {
    const url = new URL(session.hostname);
    const socketProtocol = url.protocol === 'https' ? 'wss' : 'ws';
    const socketUri = `${socketProtocol}://${url.hostname}:${url.port}/files/?token=${session.token}`;
	  // TODO For security reasons, don't do rejectUnauthorized
    this.ws = new WS(socketUri, {rejectUnauthorized: false});
    this.ws.on('open', function () {
      console.log('socket open');
    });
  
    this.ws.on('message', function (data) {
      console.log('socket data', data);
    });
  
    this.ws.on('error', function (event) {
      console.error('Socket error: ' + JSON.stringify(event));
    });
  
    this.ws.on('close', function () {
      console.log('Socket closed');
    });
  }

  public disconnect() {
    if (this.ws) {
      this.ws.terminate();
    }
  }

  getTreeItem(element: TNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TNode): Thenable<TNode[]> {
    return new Promise(resolve => {
      if (element) {
        if (element.kind !== TNodeKind.NODE_FILE) {
          let ll: TNode[] = [];
          ll.push(new TNode('label1', TNodeKind.NODE_FILE, {
            command: "spot.OpenFileEditor",
            title: "",
            arguments: ['/Users/debekoe/.v8flags.4.5.103.35.root.json'],
          }));
          ll.push(new TNode('label2', TNodeKind.NODE_FILE));
          ll.push(new TNode('label3', TNodeKind.NODE_FILE));
          resolve(ll);
        } else {
          resolve([]);
        }
      } else {
        let lll: TNode[] = [];
        let bn: TNode = new TNode('myuser', TNodeKind.NODE_FOLDER);
        lll.push(bn);
        bn = new TNode('myuser', TNodeKind.NODE_FOLDER);
        lll.push(bn);
        resolve(lll);
      }
    });
  }

}

class TNode extends vscode.TreeItem {

  constructor(
    public readonly label: string,
    public readonly kind: TNodeKind,
    public readonly command?: vscode.Command
  ) {
    super(label, (kind === TNodeKind.NODE_FILE) ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = (kind === TNodeKind.NODE_FILE) ? "NodeFile" : "NodeFolder";
  }
}