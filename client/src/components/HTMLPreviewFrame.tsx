import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Monitor, Smartphone, ArrowRight, Sparkles, Bold, Palette, Trash2, Undo2, Redo2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface HTMLPreviewFrameProps {
  html: string;
  isLoading?: boolean;
  title?: string;
  onHtmlChange?: (html: string) => void;
  onAiCommand?: (command: string) => void;
  isAiProcessing?: boolean;
}

type DeviceSize = "desktop" | "mobile";

const deviceSizes: Record<DeviceSize, { width: number; label: string }> = {
  desktop: { width: 680, label: "Desktop" },
  mobile: { width: 375, label: "Mobile" },
};

export function HTMLPreviewFrame({ 
  html, 
  isLoading, 
  title,
  onHtmlChange,
  onAiCommand,
  isAiProcessing 
}: HTMLPreviewFrameProps) {
  const [device, setDevice] = useState<DeviceSize>("desktop");
  const [aiInput, setAiInput] = useState("");
  const [showToolbar, setShowToolbar] = useState(false);
  const [toolbarPosition, setToolbarPosition] = useState({ x: 0, y: 0 });
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleAiSubmit = () => {
    if (aiInput.trim() && onAiCommand) {
      onAiCommand(aiInput.trim());
      setAiInput("");
    }
  };

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
      <div className="flex items-center justify-center gap-2 p-3 border-b bg-card/50 glass-surface">
        <div className="inline-flex rounded-lg p-1 bg-muted/50">
          {(Object.keys(deviceSizes) as DeviceSize[]).map((d) => (
            <button
              key={d}
              onClick={() => setDevice(d)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
                device === d 
                  ? "bg-background shadow-sm text-foreground" 
                  : "text-muted-foreground hover:text-foreground"
              )}
              data-testid={`button-device-${d}`}
            >
              {d === "desktop" ? <Monitor className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
              {deviceSizes[d].label}
            </button>
          ))}
        </div>
        
        <div className="flex items-center gap-1 ml-4">
          <Button
            size="icon"
            variant="ghost"
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            data-testid="button-undo"
          >
            <Undo2 className="w-4 h-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            data-testid="button-redo"
          >
            <Redo2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
      
      <div className="flex-1 flex items-start justify-center p-6 bg-muted/20 overflow-auto">
        {isLoading ? (
          <div
            className="bg-white rounded-lg shadow-lg overflow-hidden"
            style={{ width: deviceSizes[device].width }}
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
            className="bg-white rounded-lg shadow-lg overflow-hidden transition-all duration-300 glow-green-hover"
            style={{ width: deviceSizes[device].width }}
          >
            <iframe
              ref={iframeRef}
              srcDoc={html}
              title="Newsletter Preview"
              className="w-full border-0"
              style={{ minHeight: "600px", height: "auto" }}
              sandbox="allow-same-origin allow-scripts"
              data-testid="iframe-preview"
            />
          </div>
        ) : (
          <div 
            className="flex flex-col items-center justify-center text-center p-12 rounded-lg border-2 border-dashed border-muted-foreground/20"
            style={{ width: deviceSizes[device].width }}
          >
            <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
              <Monitor className="w-8 h-8 text-muted-foreground/50" />
            </div>
            <p className="text-muted-foreground mb-1">No content yet</p>
            <p className="text-sm text-muted-foreground/70">Import HTML or use AI to generate content</p>
          </div>
        )}
      </div>

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
        </div>
      )}

      {onAiCommand && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-md px-4">
          <div className="flex items-center gap-2 p-2 rounded-full bg-background/90 border shadow-lg glass-card glow-green">
            <Sparkles className="w-4 h-4 ml-2 text-primary" />
            <Input
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAiSubmit()}
              placeholder="Ask AI to edit..."
              className="border-0 bg-transparent focus-visible:ring-0 text-sm"
              disabled={isAiProcessing}
              data-testid="input-ai-command"
            />
            <Button
              size="icon"
              onClick={handleAiSubmit}
              disabled={!aiInput.trim() || isAiProcessing}
              className="rounded-full glow-green-hover"
              data-testid="button-ai-submit"
            >
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
