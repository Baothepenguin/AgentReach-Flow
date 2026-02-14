import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { NewsletterBlock, NewsletterBlockType, NewsletterDocument } from "@shared/schema";
import { GripVertical, Plus, Save, Trash2, Sparkles } from "lucide-react";

interface BlockNewsletterEditorProps {
  document?: NewsletterDocument;
  isSaving?: boolean;
  onSave: (document: NewsletterDocument) => void;
  onGenerateWithAi?: () => void;
  isGeneratingAi?: boolean;
}

const BLOCK_TYPE_LABELS: Record<NewsletterBlockType, string> = {
  text: "Text",
  image: "Image",
  button: "Button",
  divider: "Divider",
  socials: "Socials",
  grid: "Grid",
  image_button: "Image + Button",
};

const BLOCK_TYPES: NewsletterBlockType[] = [
  "text",
  "image",
  "button",
  "divider",
  "socials",
  "grid",
  "image_button",
];

function makeBlockId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `block_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function createDefaultBlock(type: NewsletterBlockType): NewsletterBlock {
  switch (type) {
    case "text":
      return {
        id: makeBlockId(),
        type,
        data: { content: "<p>Write your content here...</p>", align: "left" },
      };
    case "image":
      return {
        id: makeBlockId(),
        type,
        data: { src: "", alt: "", href: "" },
      };
    case "button":
      return {
        id: makeBlockId(),
        type,
        data: { label: "Learn more", href: "", align: "left" },
      };
    case "divider":
      return {
        id: makeBlockId(),
        type,
        data: { color: "#e5e7eb" },
      };
    case "socials":
      return {
        id: makeBlockId(),
        type,
        data: { links: [{ platform: "Instagram", href: "" }] },
      };
    case "grid":
      return {
        id: makeBlockId(),
        type,
        data: { items: [{ title: "Block title", body: "Short description", imageUrl: "" }] },
      };
    case "image_button":
      return {
        id: makeBlockId(),
        type,
        data: { imageUrl: "", alt: "", buttonLabel: "View details", buttonHref: "" },
      };
    default:
      return {
        id: makeBlockId(),
        type: "text",
        data: { content: "" },
      };
  }
}

function toSocialLinksText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => {
      const platform = typeof item?.platform === "string" ? item.platform : "";
      const href = typeof item?.href === "string" ? item.href : "";
      return `${platform}|${href}`;
    })
    .join("\n");
}

function fromSocialLinksText(value: string): Array<{ platform: string; href: string }> {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [platform, href] = line.split("|");
      return {
        platform: (platform || "").trim(),
        href: (href || "").trim(),
      };
    });
}

function toGridItemsText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => {
      const title = typeof item?.title === "string" ? item.title : "";
      const body = typeof item?.body === "string" ? item.body : "";
      const imageUrl = typeof item?.imageUrl === "string" ? item.imageUrl : "";
      return `${title}|${body}|${imageUrl}`;
    })
    .join("\n");
}

function fromGridItemsText(value: string): Array<{ title: string; body: string; imageUrl?: string }> {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [title, body, imageUrl] = line.split("|");
      return {
        title: (title || "").trim(),
        body: (body || "").trim(),
        imageUrl: (imageUrl || "").trim(),
      };
    });
}

export function BlockNewsletterEditor({ document, isSaving, onSave, onGenerateWithAi, isGeneratingAi }: BlockNewsletterEditorProps) {
  const [workingDocument, setWorkingDocument] = useState<NewsletterDocument>({
    version: "v1",
    blocks: [],
    meta: { sendMode: "ai_recommended", timezone: "America/New_York", audienceTag: "all" },
    html: "",
  });
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (!document) return;
    setWorkingDocument({
      version: "v1",
      blocks: Array.isArray(document.blocks) ? document.blocks : [],
      meta: {
        sendMode: document.meta?.sendMode || "ai_recommended",
        timezone: document.meta?.timezone || "America/New_York",
        subject: document.meta?.subject,
        previewText: document.meta?.previewText,
        fromEmail: document.meta?.fromEmail,
        audienceTag: document.meta?.audienceTag || "all",
      },
      templateId: document.templateId,
      theme: document.theme,
      html: document.html || "",
    });
    setSelectedBlockId((prev) => prev || (document.blocks?.[0]?.id ?? null));
    setIsDirty(false);
  }, [document]);

  const blocks = workingDocument.blocks || [];
  const selectedBlock = useMemo(
    () => blocks.find((block) => block.id === selectedBlockId) || null,
    [blocks, selectedBlockId]
  );

  const updateDocument = (next: NewsletterDocument) => {
    setWorkingDocument(next);
    setIsDirty(true);
  };

  const addBlock = (type: NewsletterBlockType) => {
    const newBlock = createDefaultBlock(type);
    updateDocument({
      ...workingDocument,
      blocks: [...blocks, newBlock],
    });
    setSelectedBlockId(newBlock.id);
  };

  const removeBlock = (blockId: string) => {
    const nextBlocks = blocks.filter((block) => block.id !== blockId);
    updateDocument({
      ...workingDocument,
      blocks: nextBlocks,
    });
    if (selectedBlockId === blockId) {
      setSelectedBlockId(nextBlocks[0]?.id || null);
    }
  };

  const updateSelectedBlockData = (patch: Record<string, unknown>) => {
    if (!selectedBlock) return;
    const nextBlocks = blocks.map((block) =>
      block.id === selectedBlock.id
        ? {
            ...block,
            data: {
              ...(block.data || {}),
              ...patch,
            },
          }
        : block
    );
    updateDocument({
      ...workingDocument,
      blocks: nextBlocks,
    });
  };

  const handleDropOnBlock = (targetBlockId: string) => {
    if (!draggedBlockId || draggedBlockId === targetBlockId) return;
    const sourceIndex = blocks.findIndex((block) => block.id === draggedBlockId);
    const targetIndex = blocks.findIndex((block) => block.id === targetBlockId);
    if (sourceIndex < 0 || targetIndex < 0) return;

    const nextBlocks = [...blocks];
    const [moved] = nextBlocks.splice(sourceIndex, 1);
    nextBlocks.splice(targetIndex, 0, moved);

    updateDocument({
      ...workingDocument,
      blocks: nextBlocks,
    });
    setDraggedBlockId(null);
  };

  const handleSave = () => {
    onSave({
      ...workingDocument,
      version: "v1",
    });
    setIsDirty(false);
  };

  return (
    <div className="h-full grid grid-cols-[220px_minmax(0,1fr)_280px]">
      <aside className="border-r p-3 space-y-2 overflow-y-auto bg-muted/20">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Blocks</div>
        {BLOCK_TYPES.map((type) => (
          <Button
            key={type}
            variant="ghost"
            className="w-full justify-start"
            onClick={() => addBlock(type)}
            data-testid={`button-add-block-${type}`}
          >
            <Plus className="w-4 h-4 mr-2" />
            {BLOCK_TYPE_LABELS[type]}
          </Button>
        ))}
      </aside>

      <main className="p-4 overflow-y-auto bg-background">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium">Canvas</div>
          <div className="flex items-center gap-2">
            {onGenerateWithAi && (
              <Button
                variant="secondary"
                onClick={onGenerateWithAi}
                disabled={!!isGeneratingAi}
                data-testid="button-generate-blocks-ai"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                {isGeneratingAi ? "Generating..." : "AI Draft"}
              </Button>
            )}
            <Button onClick={handleSave} disabled={isSaving || !isDirty} data-testid="button-save-block-document">
              <Save className="w-4 h-4 mr-2" />
              {isSaving ? "Saving..." : "Save Blocks"}
            </Button>
          </div>
        </div>
        <div className="space-y-2">
          {blocks.length === 0 && (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              Add blocks from the left panel to build the newsletter.
            </Card>
          )}
          {blocks.map((block) => (
            <Card
              key={block.id}
              draggable
              onDragStart={() => setDraggedBlockId(block.id)}
              onDragEnd={() => setDraggedBlockId(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => handleDropOnBlock(block.id)}
              className={`p-3 cursor-pointer border ${
                selectedBlockId === block.id ? "border-primary" : "border-border"
              }`}
              onClick={() => setSelectedBlockId(block.id)}
              data-testid={`block-item-${block.id}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <GripVertical className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{BLOCK_TYPE_LABELS[block.type]}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(event) => {
                    event.stopPropagation();
                    removeBlock(block.id);
                  }}
                  data-testid={`button-remove-block-${block.id}`}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              <div className="text-xs text-muted-foreground mt-1">ID: {block.id}</div>
            </Card>
          ))}
        </div>
      </main>

      <aside className="border-l p-3 overflow-y-auto space-y-3">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Campaign</div>
        <div className="space-y-2">
          <Input
            placeholder="Subject line"
            value={workingDocument.meta?.subject || ""}
            onChange={(event) =>
              updateDocument({
                ...workingDocument,
                meta: {
                  ...(workingDocument.meta || {}),
                  subject: event.target.value,
                },
              })
            }
            data-testid="input-block-meta-subject"
          />
          <Input
            placeholder="Preview text"
            value={workingDocument.meta?.previewText || ""}
            onChange={(event) =>
              updateDocument({
                ...workingDocument,
                meta: {
                  ...(workingDocument.meta || {}),
                  previewText: event.target.value,
                },
              })
            }
            data-testid="input-block-meta-preview"
          />
          <Input
            placeholder="From email"
            value={workingDocument.meta?.fromEmail || ""}
            onChange={(event) =>
              updateDocument({
                ...workingDocument,
                meta: {
                  ...(workingDocument.meta || {}),
                  fromEmail: event.target.value,
                },
              })
            }
            data-testid="input-block-meta-from"
          />
          <Input
            placeholder='Audience tag (default: "all")'
            value={workingDocument.meta?.audienceTag || ""}
            onChange={(event) =>
              updateDocument({
                ...workingDocument,
                meta: {
                  ...(workingDocument.meta || {}),
                  audienceTag: event.target.value,
                },
              })
            }
            data-testid="input-block-meta-audience-tag"
          />
        </div>

        <div className="pt-2 border-t" />
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Block Properties</div>
        {!selectedBlock && <div className="text-sm text-muted-foreground">Select a block to edit properties.</div>}

        {selectedBlock?.type === "text" && (
          <Textarea
            value={typeof selectedBlock.data?.content === "string" ? selectedBlock.data.content : ""}
            onChange={(event) => updateSelectedBlockData({ content: event.target.value })}
            className="min-h-[200px]"
            data-testid="textarea-block-text-content"
          />
        )}

        {selectedBlock?.type === "image" && (
          <div className="space-y-2">
            <Input
              placeholder="Image URL"
              value={typeof selectedBlock.data?.src === "string" ? selectedBlock.data.src : ""}
              onChange={(event) => updateSelectedBlockData({ src: event.target.value })}
              data-testid="input-block-image-src"
            />
            <Input
              placeholder="Alt text"
              value={typeof selectedBlock.data?.alt === "string" ? selectedBlock.data.alt : ""}
              onChange={(event) => updateSelectedBlockData({ alt: event.target.value })}
              data-testid="input-block-image-alt"
            />
            <Input
              placeholder="Optional click URL"
              value={typeof selectedBlock.data?.href === "string" ? selectedBlock.data.href : ""}
              onChange={(event) => updateSelectedBlockData({ href: event.target.value })}
              data-testid="input-block-image-href"
            />
          </div>
        )}

        {selectedBlock?.type === "button" && (
          <div className="space-y-2">
            <Input
              placeholder="Button label"
              value={typeof selectedBlock.data?.label === "string" ? selectedBlock.data.label : ""}
              onChange={(event) => updateSelectedBlockData({ label: event.target.value })}
              data-testid="input-block-button-label"
            />
            <Input
              placeholder="Button URL"
              value={typeof selectedBlock.data?.href === "string" ? selectedBlock.data.href : ""}
              onChange={(event) => updateSelectedBlockData({ href: event.target.value })}
              data-testid="input-block-button-href"
            />
          </div>
        )}

        {selectedBlock?.type === "divider" && (
          <Input
            placeholder="Divider color (hex)"
            value={typeof selectedBlock.data?.color === "string" ? selectedBlock.data.color : ""}
            onChange={(event) => updateSelectedBlockData({ color: event.target.value })}
            data-testid="input-block-divider-color"
          />
        )}

        {selectedBlock?.type === "socials" && (
          <Textarea
            value={toSocialLinksText(selectedBlock.data?.links)}
            onChange={(event) => updateSelectedBlockData({ links: fromSocialLinksText(event.target.value) })}
            className="min-h-[130px]"
            placeholder="Instagram|https://...\nFacebook|https://..."
            data-testid="textarea-block-socials-links"
          />
        )}

        {selectedBlock?.type === "grid" && (
          <Textarea
            value={toGridItemsText(selectedBlock.data?.items)}
            onChange={(event) => updateSelectedBlockData({ items: fromGridItemsText(event.target.value) })}
            className="min-h-[160px]"
            placeholder="Title|Body|Image URL"
            data-testid="textarea-block-grid-items"
          />
        )}

        {selectedBlock?.type === "image_button" && (
          <div className="space-y-2">
            <Input
              placeholder="Image URL"
              value={typeof selectedBlock.data?.imageUrl === "string" ? selectedBlock.data.imageUrl : ""}
              onChange={(event) => updateSelectedBlockData({ imageUrl: event.target.value })}
              data-testid="input-block-image-button-image-url"
            />
            <Input
              placeholder="Alt text"
              value={typeof selectedBlock.data?.alt === "string" ? selectedBlock.data.alt : ""}
              onChange={(event) => updateSelectedBlockData({ alt: event.target.value })}
              data-testid="input-block-image-button-alt"
            />
            <Input
              placeholder="Button label"
              value={typeof selectedBlock.data?.buttonLabel === "string" ? selectedBlock.data.buttonLabel : ""}
              onChange={(event) => updateSelectedBlockData({ buttonLabel: event.target.value })}
              data-testid="input-block-image-button-label"
            />
            <Input
              placeholder="Button URL"
              value={typeof selectedBlock.data?.buttonHref === "string" ? selectedBlock.data.buttonHref : ""}
              onChange={(event) => updateSelectedBlockData({ buttonHref: event.target.value })}
              data-testid="input-block-image-button-href"
            />
          </div>
        )}
      </aside>
    </div>
  );
}
