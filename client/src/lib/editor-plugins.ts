export interface EditorPlugin {
  id: string;
  name: string;
  description: string;
  component: React.ComponentType<EditorPluginProps>;
}

export interface EditorPluginProps {
  html: string;
  isLoading?: boolean;
  onHtmlChange?: (html: string) => void;
  fullWidth?: boolean;
}

export const editorPlugins: EditorPlugin[] = [];

export function registerEditorPlugin(plugin: EditorPlugin) {
  const existing = editorPlugins.findIndex(p => p.id === plugin.id);
  if (existing >= 0) {
    editorPlugins[existing] = plugin;
  } else {
    editorPlugins.push(plugin);
  }
}

export function getEditorPlugin(id: string): EditorPlugin | undefined {
  return editorPlugins.find(p => p.id === id);
}

export function getDefaultEditor(): EditorPlugin | undefined {
  return editorPlugins[0];
}
