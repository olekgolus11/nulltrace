export type PanelDirection = -1 | 1;

export interface PanelDefinition<TPanel extends string> {
  id: TPanel;
  label: string;
}
