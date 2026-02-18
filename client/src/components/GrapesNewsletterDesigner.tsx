import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "grapesjs";
import grapesjs from "grapesjs";
import presetNewsletter from "grapesjs-preset-newsletter";
import "grapesjs/dist/css/grapes.min.css";

import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Save, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type GrapesDesignJson = {
  editor: "grapesjs";
  project: any;
};

function isGrapesDesignJson(value: unknown): value is GrapesDesignJson {
  return (
    !!value &&
    typeof value === "object" &&
    (value as any).editor === "grapesjs" &&
    !!(value as any).project
  );
}

function extractBodyAndCss(html: string): { bodyHtml: string; css: string } {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const css = Array.from(doc.querySelectorAll("style"))
      .map((el) => el.textContent || "")
      .join("\n")
      .trim();
    const bodyHtml = doc.body?.innerHTML || html;
    return { bodyHtml, css };
  } catch {
    return { bodyHtml: html, css: "" };
  }
}

function wrapHtmlDocument(bodyHtml: string, css: string): string {
  const safeCss = css ? `<style type="text/css">${css}</style>` : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${safeCss}
  </head>
  <body style="margin:0;padding:0;">
    ${bodyHtml}
  </body>
</html>`;
}

export function GrapesNewsletterDesigner({
  newsletterId,
  initialHtml,
  designJson,
  disabled,
}: {
  newsletterId: string;
  initialHtml: string;
  designJson: unknown;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);

  const initialPayload = useMemo(() => {
    const hasSavedProject = isGrapesDesignJson(designJson);
    return {
      hasSavedProject,
      project: hasSavedProject ? (designJson as GrapesDesignJson).project : null,
      html: typeof initialHtml === "string" ? initialHtml : "",
    };
  }, [designJson, initialHtml]);

  useEffect(() => {
    if (!containerRef.current) return;
    if (editorRef.current) return;

    const editor = grapesjs.init({
      container: containerRef.current,
      height: "100%",
      fromElement: false,
      // We persist editor state in Flow (newsletter.designJson) instead of GrapesJS storage.
      storageManager: false as any,
      selectorManager: { componentFirst: true },
      plugins: [presetNewsletter],
      pluginsOpts: {
        [presetNewsletter as any]: {
          // Keep the editor focused on newsletter sections.
          // We can refine blocks and styles later.
        },
      },
    });

    editorRef.current = editor;

    // Load saved project data first; otherwise import the current HTML.
    if (initialPayload.hasSavedProject && initialPayload.project) {
      try {
        editor.loadProjectData(initialPayload.project);
      } catch (e) {
        console.warn("Failed to load GrapesJS project, falling back to HTML import:", e);
      }
    }

    if (!initialPayload.hasSavedProject) {
      const { bodyHtml, css } = extractBodyAndCss(initialPayload.html || "");
      if (bodyHtml.trim()) {
        editor.setComponents(bodyHtml);
      }
      if (css.trim()) {
        editor.setStyle(css);
      }
    }

    setReady(true);

    return () => {
      try {
        editor.destroy();
      } catch {}
      editorRef.current = null;
      setReady(false);
    };
  }, [initialPayload]);

  const handleSave = async () => {
    if (!editorRef.current || disabled) return;
    setSaving(true);
    try {
      const editor = editorRef.current;
      const project = editor.getProjectData();
      const bodyHtml = editor.getHtml() || "";
      const css = editor.getCss() || "";
      const fullHtml = wrapHtmlDocument(bodyHtml, css);

      await apiRequest("PATCH", `/api/newsletters/${newsletterId}`, {
        editorVersion: "v2",
        designJson: {
          editor: "grapesjs",
          project,
        },
        documentJson: {
          html: fullHtml,
        },
      });

      queryClient.invalidateQueries({ queryKey: ["/api/newsletters", newsletterId] });
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters"] });

      toast({ title: "Designer saved" });
    } catch (error: any) {
      toast({ title: "Failed to save designer", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-background">
        <div className="text-sm font-medium flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary/70" />
          Designer (Beta)
        </div>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!ready || saving || disabled}
          data-testid="button-grapes-save"
        >
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          Save
        </Button>
      </div>
      <div className="flex-1 min-h-0">
        <div ref={containerRef} className="h-full w-full" data-testid="grapes-container" />
      </div>
    </div>
  );
}
