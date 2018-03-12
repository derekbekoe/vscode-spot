import * as vscode from "vscode";

export enum TNodeKind { NODE_FILE, NODE_FOLDER };


export class SpotTreeDataProvider implements vscode.TreeDataProvider<TNode> {

  private _onDidChangeTreeData: vscode.EventEmitter<TNode | undefined> = new vscode.EventEmitter<TNode | undefined>();
  readonly onDidChangeTreeData: vscode.Event<TNode | undefined> = this._onDidChangeTreeData.event;

  constructor() {}

  public refresh(): void {
    this._onDidChangeTreeData.fire();
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