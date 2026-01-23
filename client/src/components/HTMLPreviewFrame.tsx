import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Bold, Trash2, Undo2, Redo2, Code, Plus, Monitor, Smartphone } from "lucide-react";

interface HTMLPreviewFrameProps {
  html: string;
  isLoading?: boolean;
  title?: string;
  onHtmlChange?: (html: string) => void;
  onCreateCampaign?: () => void;
  fullWidth?: boolean;
}

export function HTMLPreviewFrame({ 
  html, 
  isLoading, 
  title,
  onHtmlChange,
  onCreateCampaign,
  fullWidth = false
}: HTMLPreviewFrameProps) {
  const [showToolbar, setShowToolbar] = useState(false);
  const [toolbarPosition, setToolbarPosition] = useState({ x: 0, y: 0 });
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const [deviceMode, setDeviceMode] = useState<"desktop" | "mobile">("desktop");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const previewWidth = fullWidth ? "100%" : (deviceMode === "mobile" ? 375 : 680);

  const saveToUndo = useCallback(() => {
    if (html) {
      setUndoStack(prev => [...prev.slice(-19), html]);
      setRedoStack([]);
    }
  }, [html]);

  const handleUndo = () => {
    if (undoStack.length > 0 && onHtmlChange) {
      const lastState = undoStack[undoStack.length - 1];
      setUndoStack(prev => prev.slice(0, -1));
      setRedoStack(prev => [...prev, html]);
      onHtmlChange(lastState);
    }
  };

  const handleRedo = () => {
    if (redoStack.length > 0 && onHtmlChange) {
      const nextState = redoStack[redoStack.length - 1];
      setRedoStack(prev => prev.slice(0, -1));
      setUndoStack(prev => [...prev, html]);
      onHtmlChange(nextState);
    }
  };

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !html) return;

    const handleLoad = () => {
      const doc = iframe.contentDocument;
      if (!doc) return;

      doc.body.contentEditable = "true";
      doc.body.style.cursor = "text";
      
      const style = doc.createElement("style");
      style.textContent = `
        *:focus { outline: 2px solid hsl(152 65% 28% / 0.5); outline-offset: 2px; }
        *:hover { outline: 1px dashed hsl(152 65% 28% / 0.3); }
      `;
      doc.head.appendChild(style);

      doc.body.addEventListener("input", () => {
        if (onHtmlChange) {
          const fullHtml = `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
          onHtmlChange(fullHtml);
        }
      });

      doc.body.addEventListener("mouseup", () => {
        const selection = doc.getSelection();
        if (selection && selection.toString().length > 0) {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          setToolbarPosition({
            x: rect.left + rect.width / 2,
            y: rect.top - 50
          });
          setShowToolbar(true);
        } else {
          setShowToolbar(false);
        }
      });
    };

    iframe.addEventListener("load", handleLoad);
    return () => iframe.removeEventListener("load", handleLoad);
  }, [html, onHtmlChange]);

  const getFullHtml = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentDocument) return html;
    const doc = iframe.contentDocument;
    return `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
  }, [html]);

  const execCommand = (command: string, value?: string) => {
    const iframe = iframeRef.current;
    if (!iframe?.contentDocument) return;
    saveToUndo();
    iframe.contentDocument.execCommand(command, false, value);
    if (onHtmlChange) {
      onHtmlChange(getFullHtml());
    }
  };

  const handleDelete = () => {
    const iframe = iframeRef.current;
    if (!iframe?.contentDocument) return;
    const selection = iframe.contentDocument.getSelection();
    if (selection && selection.rangeCount > 0) {
      saveToUndo();
      const range = selection.getRangeAt(0);
      const parentElement = range.commonAncestorContainer.parentElement;
      if (parentElement && parentElement !== iframe.contentDocument.body) {
        parentElement.remove();
        if (onHtmlChange) {
          onHtmlChange(getFullHtml());
        }
      }
    }
    setShowToolbar(false);
  };

  return (
    <div className="flex flex-col h-full relative">
      <div className={`flex-1 flex items-start justify-center overflow-auto ${fullWidth ? '' : 'p-4 bg-muted/20'}`}>
        {isLoading ? (
          <div
            className="bg-white rounded-lg shadow-lg overflow-hidden"
            style={{ width: previewWidth }}
          >
            <Skeleton className="h-48 w-full" />
            <div className="p-4 space-y-3">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          </div>
        ) : html ? (
          <div
            className={`bg-white overflow-hidden transition-all duration-300 ${
              deviceMode === "mobile" && !fullWidth
                ? "rounded-3xl border-4 border-gray-700 shadow-lg" 
                : fullWidth ? "" : "rounded-lg shadow-lg glow-green-hover"
            }`}
            style={{ width: previewWidth, maxWidth: fullWidth ? undefined : previewWidth }}
          >
            <iframe
              ref={iframeRef}
              srcDoc={html}
              title="Newsletter Preview"
              className="w-full border-0"
              style={{ 
                minHeight: deviceMode === "mobile" ? "667px" : "600px", 
                height: "auto" 
              }}
              sandbox="allow-same-origin allow-scripts"
              data-testid="iframe-preview"
            />
          </div>
        ) : (
          <div 
            className="flex flex-col items-center justify-center text-center p-12 rounded-lg border-2 border-dashed border-muted-foreground/20"
            style={{ width: previewWidth }}
          >
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Code className="w-8 h-8 text-primary/60" />
            </div>
            <p className="text-lg font-medium mb-2">Import Your HTML</p>
            <p className="text-sm text-muted-foreground mb-4">
              Create a new campaign and paste your newsletter HTML to get started
            </p>
            {onCreateCampaign && (
              <Button onClick={onCreateCampaign} className="glow-green-hover" data-testid="button-import-html-empty">
                <Plus className="w-4 h-4 mr-2" />
                New Campaign
              </Button>
            )}
          </div>
        )}
      </div>

      {html && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-background/95 backdrop-blur-sm rounded-full p-1 shadow-lg border z-10">
          <Button
            size="icon"
            variant={deviceMode === "desktop" ? "secondary" : "ghost"}
            onClick={() => setDeviceMode("desktop")}
            className="rounded-full"
            data-testid="button-device-desktop"
          >
            <Monitor className="w-4 h-4" />
          </Button>
          <Button
            size="icon"
            variant={deviceMode === "mobile" ? "secondary" : "ghost"}
            onClick={() => setDeviceMode("mobile")}
            className="rounded-full"
            data-testid="button-device-mobile"
          >
            <Smartphone className="w-4 h-4" />
          </Button>
        </div>
      )}

      {showToolbar && (
        <div 
          className="fixed z-50 flex items-center gap-1 p-1.5 rounded-lg bg-popover border shadow-lg glass-card"
          style={{ 
            left: `${toolbarPosition.x}px`, 
            top: `${toolbarPosition.y}px`,
            transform: "translateX(-50%)"
          }}
        >
          <Button size="icon" variant="ghost" onClick={() => execCommand("bold")} data-testid="toolbar-bold">
            <Bold className="w-4 h-4" />
          </Button>
          <input
            type="color"
            className="w-8 h-8 rounded cursor-pointer border-0 p-0"
            onChange={(e) => execCommand("foreColor", e.target.value)}
            data-testid="toolbar-color"
          />
          <Button size="icon" variant="ghost" onClick={handleDelete} data-testid="toolbar-delete">
            <Trash2 className="w-4 h-4" />
          </Button>
          <div className="w-px h-5 bg-border mx-0.5" />
          <Button size="icon" variant="ghost" onClick={handleUndo} disabled={undoStack.length === 0} data-testid="toolbar-undo">
            <Undo2 className="w-4 h-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={handleRedo} disabled={redoStack.length === 0} data-testid="toolbar-redo">
            <Redo2 className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
