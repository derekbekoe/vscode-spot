import * as vscode from "vscode";
import { SpotFileTracker, SpotFile } from "./spotFiles";

export enum TNodeKind { NODE_FILE, NODE_FOLDER };


export class SpotTreeDataProvider implements vscode.TreeDataProvider<TNode> {

  private _onDidChangeTreeData: vscode.EventEmitter<TNode | undefined> = new vscode.EventEmitter<TNode | undefined>();
  readonly onDidChangeTreeData: vscode.Event<TNode | undefined> = this._onDidChangeTreeData.event;

  private tree: TNode[] = [];

  constructor(private fileTracker: SpotFileTracker) {
    fileTracker.onFilesChanged(files => {
      this._onDidChangeTreeData.fire();
    });

  }

  getTreeItem(element: TNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TNode): Thenable<TNode[]> {
    console.log('Called getChildren');
    return new Promise(resolve => {
      if (element) {
        if (element.spotFile.children) {
          let ll: TNode[] = [];
          for (let f of element.spotFile.children.keys()) {
            var v: SpotFile | undefined = element.spotFile.children.get(f);
            if (v) {
              let bn: TNode = new TNode(f, v.isDirectory ? TNodeKind.NODE_FOLDER : TNodeKind.NODE_FILE, v);
              ll.push(bn);
            }
          }
          // ll.push(new TNode('label1', TNodeKind.NODE_FILE, undefined, {
          //   command: "spot.OpenFileEditor",
          //   title: "",
          //   arguments: ['/Users/debekoe/.v8flags.4.5.103.35.root.json'],
          // }));
          resolve(ll);
        } else {
          resolve([]);
        }
      } else {
        // Root
        let lll: TNode[] = [];
        for (let f of this.fileTracker.files.keys()) {
          var v: SpotFile | undefined = this.fileTracker.files.get(f);
          if (v) {
            let bn: TNode = new TNode(f, v.isDirectory ? TNodeKind.NODE_FOLDER : TNodeKind.NODE_FILE, v);
            lll.push(bn);
          }
        }
        resolve(lll);
      }
    });
  }

}

class TNode extends vscode.TreeItem {

  constructor(
    public readonly label: string,
    public readonly kind: TNodeKind,
    public readonly spotFile: SpotFile,
    public readonly command?: vscode.Command
  ) {
    super(label, (kind === TNodeKind.NODE_FILE) ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = (kind === TNodeKind.NODE_FILE) ? "NodeFile" : "NodeFolder";
  }
}