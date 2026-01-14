import { useRef, useCallback, useEffect, useState } from "react";
import EmailEditor, { EditorRef, EmailEditorProps } from "react-email-editor";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Save, Download, Undo2, Eye, Loader2 } from "lucide-react";

interface UnlayerEditorProps {
  designJson?: object | null;
  html?: string;
  onSave?: (data: { html: string; designJson: object }) => void;
  isSaving?: boolean;
  branding?: {
    primaryColor?: string;
    logoUrl?: string;
    companyName?: string;
  };
  projectId?: number;
}

const DEFAULT_DESIGN = {
  counters: { u_column: 1, u_row: 1, u_content_text: 1 },
  body: {
    id: "root",
    rows: [
      {
        id: "row-1",
        cells: [1],
        columns: [
          {
            id: "col-1",
            contents: [
              {
                id: "text-1",
                type: "text",
                values: {
                  containerPadding: "20px",
                  text: "<h1 style='text-align: center;'>Welcome to your newsletter</h1><p style='text-align: center;'>Start editing to create your email content.</p>"
                }
              }
            ],
            values: {}
          }
        ],
        values: {
          displayCondition: null,
          columns: false,
          backgroundColor: "",
          columnsBackgroundColor: "",
          backgroundImage: {
            url: "",
            fullWidth: true,
            repeat: "no-repeat",
            size: "custom",
            position: "center"
          },
          padding: "0px",
          anchor: "",
          hideDesktop: false,
          _meta: { htmlID: "u_row_1", htmlClassNames: "u_row" }
        }
      }
    ],
    values: {
      textColor: "#000000",
      backgroundColor: "#F9F9F9",
      backgroundImage: {
        url: "",
        fullWidth: true,
        repeat: "no-repeat",
        size: "custom",
        position: "center"
      },
      contentWidth: "600px",
      contentAlign: "center",
      fontFamily: { label: "Inter", value: "'Inter', sans-serif" },
      preheaderText: "",
      linkStyle: {
        body: true,
        linkColor: "#1a5f4a",
        linkHoverColor: "#0d4735",
        linkUnderline: true,
        linkHoverUnderline: true
      },
      _meta: { htmlID: "u_body", htmlClassNames: "u_body" }
    }
  }
};

export function UnlayerEditor({
  designJson,
  html,
  onSave,
  isSaving,
  branding,
  projectId = 273372
}: UnlayerEditorProps) {
  const emailEditorRef = useRef<EditorRef>(null);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");

  const handleSave = useCallback(() => {
    const unlayer = emailEditorRef.current?.editor;
    if (!unlayer) return;

    unlayer.exportHtml((data: { design: object; html: string }) => {
      const { design, html } = data;
      if (onSave) {
        onSave({ html, designJson: design });
      }
    });
  }, [onSave]);

  const handleExportHtml = useCallback(() => {
    const unlayer = emailEditorRef.current?.editor;
    if (!unlayer) return;

    unlayer.exportHtml((data: { html: string }) => {
      const blob = new Blob([data.html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "newsletter.html";
      a.click();
      URL.revokeObjectURL(url);
    });
  }, []);

  const handlePreview = useCallback(() => {
    const unlayer = emailEditorRef.current?.editor;
    if (!unlayer) return;

    unlayer.exportHtml((data: { html: string }) => {
      setPreviewHtml(data.html);
      setShowPreview(true);
    });
  }, []);

  const onReady: EmailEditorProps["onReady"] = useCallback((unlayer: any) => {
    setIsEditorReady(true);
    
    if (designJson && Object.keys(designJson).length > 0) {
      unlayer.loadDesign(designJson);
    } else if (html && html.trim().length > 0) {
      unlayer.loadDesign({
        counters: { u_column: 1, u_row: 1, u_content_html: 1 },
        body: {
          id: "root",
          rows: [
            {
              id: "row-1",
              cells: [1],
              columns: [
                {
                  id: "col-1",
                  contents: [
                    {
                      id: "html-1",
                      type: "html",
                      values: {
                        containerPadding: "0px",
                        html: html
                      }
                    }
                  ],
                  values: {}
                }
              ],
              values: {}
            }
          ],
          values: {
            textColor: "#000000",
            backgroundColor: "#F9F9F9",
            contentWidth: "600px",
            contentAlign: "center",
            fontFamily: { label: "Inter", value: "'Inter', sans-serif" }
          }
        }
      });
    } else {
      const design = { ...DEFAULT_DESIGN };
      if (branding?.primaryColor) {
        design.body.values.linkStyle = {
          ...design.body.values.linkStyle,
          linkColor: branding.primaryColor,
          linkHoverColor: branding.primaryColor
        };
      }
      unlayer.loadDesign(design);
    }
  }, [designJson, html, branding]);

  const editorOptions: EmailEditorProps["options"] = {
    appearance: {
      theme: "modern_light",
      panels: {
        tools: {
          dock: "left"
        }
      }
    },
    features: {
      textEditor: {
        spellChecker: true
      }
    },
    tools: {
      image: {
        enabled: true
      },
      button: {
        enabled: true
      },
      divider: {
        enabled: true
      },
      heading: {
        enabled: true
      },
      html: {
        enabled: true
      },
      menu: {
        enabled: true
      },
      social: {
        enabled: true
      },
      text: {
        enabled: true
      },
      timer: {
        enabled: true
      },
      video: {
        enabled: true
      }
    }
  };

  if (branding?.primaryColor) {
    editorOptions.appearance = {
      ...editorOptions.appearance,
      theme: "modern_light"
    };
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3 border-b bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">
            {isEditorReady ? "Editor Ready" : "Loading Editor..."}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handlePreview}
            disabled={!isEditorReady}
            data-testid="button-preview"
          >
            <Eye className="w-4 h-4 mr-1" />
            Preview
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportHtml}
            disabled={!isEditorReady}
            data-testid="button-export"
          >
            <Download className="w-4 h-4 mr-1" />
            Export
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!isEditorReady || isSaving}
            className="glow-green-hover"
            data-testid="button-save"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-1" />
            )}
            Save
          </Button>
        </div>
      </div>

      <div className="flex-1 relative">
        {!isEditorReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-10">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Loading email editor...</span>
            </div>
          </div>
        )}
        <EmailEditor
          ref={emailEditorRef}
          onReady={onReady}
          projectId={projectId}
          options={editorOptions}
          minHeight="100%"
          style={{ height: "100%", border: "none" }}
        />
      </div>

      {showPreview && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-background border rounded-lg shadow-xl w-full max-w-4xl h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-medium">Email Preview</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowPreview(false)}
                data-testid="button-close-preview"
              >
                Close
              </Button>
            </div>
            <div className="flex-1 overflow-auto bg-muted/20 p-4">
              <div className="bg-white rounded-lg shadow-lg mx-auto" style={{ maxWidth: "600px" }}>
                <iframe
                  srcDoc={previewHtml}
                  title="Newsletter Preview"
                  className="w-full border-0"
                  style={{ minHeight: "600px" }}
                  data-testid="iframe-unlayer-preview"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
