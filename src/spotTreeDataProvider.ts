import * as vscode from "vscode";
import { SpotFileTracker, SpotFile } from "./spotFiles";

export enum TNodeKind { NODE_FILE, NODE_FOLDER };


export class SpotTreeDataProvider implements vscode.TreeDataProvider<TNode> {

  private _onDidChangeTreeData: vscode.EventEmitter<TNode | undefined> = new vscode.EventEmitter<TNode | undefined>();
  readonly onDidChangeTreeData: vscode.Event<TNode | undefined> = this._onDidChangeTreeData.event;

  constructor(private fileTracker: SpotFileTracker) {
    fileTracker.onFilesChanged(files => {
      this._onDidChangeTreeData.fire();
    });

  }

  getTreeItem(element: TNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TNode): Thenable<TNode[]> {
    return new Promise(resolve => {
      let ll: TNode[] = [];
      let sp_map: Map<string, SpotFile>;
      sp_map = element ? element.spotFile.children : this.fileTracker.files;
      for (let f of sp_map.keys()) {
        var v: SpotFile | undefined = sp_map.get(f);
        if (v) {
          var bn_command = v.isDirectory ? undefined : {
              command: "spot.OpenFileEditor",
              title: f,
              arguments: [v.path],
          };
          let bn: TNode = new TNode(f, v.isDirectory ? TNodeKind.NODE_FOLDER : TNodeKind.NODE_FILE, v, bn_command);
          ll.push(bn);
        }
      }
      resolve(ll);
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