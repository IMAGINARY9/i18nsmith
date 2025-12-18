import * as vscode from "vscode";

export class OutputChannelService implements vscode.Disposable {
  public readonly main: vscode.OutputChannel;
  public readonly cli: vscode.OutputChannel;
  public readonly verbose: vscode.OutputChannel;

  constructor(context: vscode.ExtensionContext) {
    this.main = vscode.window.createOutputChannel("i18nsmith");
    this.cli = vscode.window.createOutputChannel("i18nsmith CLI");
    this.verbose = vscode.window.createOutputChannel("i18nsmith (Verbose)");

    context.subscriptions.push(this.main, this.cli, this.verbose);
  }

  dispose() {
    // Channels are disposed automatically via context subscriptions
  }
}
