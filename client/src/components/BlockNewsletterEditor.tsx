import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { NewsletterBlock, NewsletterBlockType, NewsletterDocument } from "@shared/schema";
import { ArrowDown, ArrowUp, GripVertical, Plus, Save, Trash2, Sparkles } from "lucide-react";

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
        data: {
          style: "classic",
          items: [
            {
              address: "123 Maple St",
              price: "$925,000",
              details: "3 bd • 2 ba • 1,780 sqft",
              imageUrl: "",
              href: "",
            },
          ],
        },
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

type ListingCardItem = {
  address: string;
  price: string;
  details: string;
  imageUrl?: string;
  href?: string;
};

const GRID_STYLES = ["classic", "minimal", "spotlight"] as const;
type GridStyle = (typeof GRID_STYLES)[number];

function normalizeGridStyle(value: unknown): GridStyle {
  if (typeof value === "string" && GRID_STYLES.includes(value as GridStyle)) {
    return value as GridStyle;
  }
  return "classic";
}

function createDefaultListingItem(): ListingCardItem {
  return {
    address: "",
    price: "",
    details: "",
    imageUrl: "",
    href: "",
  };
}

function normalizeListingItems(value: unknown): ListingCardItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const address =
      typeof item?.address === "string"
        ? item.address
        : typeof item?.title === "string"
          ? item.title
          : "";
    const details =
      typeof item?.details === "string"
        ? item.details
        : typeof item?.body === "string"
          ? item.body
          : "";
    const price = typeof item?.price === "string" ? item.price : "";
    const imageUrl = typeof item?.imageUrl === "string" ? item.imageUrl : "";
    const href =
      typeof item?.href === "string"
        ? item.href
        : typeof item?.url === "string"
          ? item.url
          : "";
    return { address, price, details, imageUrl, href };
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

  const moveBlock = (blockId: string, direction: -1 | 1) => {
    const sourceIndex = blocks.findIndex((block) => block.id === blockId);
    if (sourceIndex < 0) return;
    const targetIndex = sourceIndex + direction;
    if (targetIndex < 0 || targetIndex >= blocks.length) return;
    const nextBlocks = [...blocks];
    const [moved] = nextBlocks.splice(sourceIndex, 1);
    nextBlocks.splice(targetIndex, 0, moved);
    updateDocument({
      ...workingDocument,
      blocks: nextBlocks,
    });
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

  const selectedGridItems =
    selectedBlock?.type === "grid"
      ? normalizeListingItems(selectedBlock.data?.items)
      : [];
  const selectedGridStyle =
    selectedBlock?.type === "grid"
      ? normalizeGridStyle(selectedBlock.data?.style)
      : "classic";

  const setSelectedGridItems = (items: ListingCardItem[]) => {
    if (selectedBlock?.type !== "grid") return;
    updateSelectedBlockData({ items });
  };

  const upsertSelectedGridItem = (index: number, patch: Partial<ListingCardItem>) => {
    if (selectedBlock?.type !== "grid") return;
    const nextItems = [...selectedGridItems];
    const existing = nextItems[index] || createDefaultListingItem();
    nextItems[index] = { ...existing, ...patch };
    setSelectedGridItems(nextItems);
  };

  const addSelectedGridItem = () => {
    if (selectedBlock?.type !== "grid") return;
    setSelectedGridItems([...selectedGridItems, createDefaultListingItem()]);
  };

  const removeSelectedGridItem = (index: number) => {
    if (selectedBlock?.type !== "grid") return;
    const nextItems = selectedGridItems.filter((_, i) => i !== index);
    setSelectedGridItems(nextItems);
  };

  const moveSelectedGridItem = (index: number, direction: -1 | 1) => {
    if (selectedBlock?.type !== "grid") return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= selectedGridItems.length) return;
    const nextItems = [...selectedGridItems];
    const [moved] = nextItems.splice(index, 1);
    nextItems.splice(nextIndex, 0, moved);
    setSelectedGridItems(nextItems);
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
            (() => {
              const blockIndex = blocks.findIndex((b) => b.id === block.id);
              const isFirst = blockIndex === 0;
              const isLast = blockIndex === blocks.length - 1;
              return (
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
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(event) => {
                      event.stopPropagation();
                      moveBlock(block.id, -1);
                    }}
                    disabled={isFirst}
                    data-testid={`button-move-block-up-${block.id}`}
                  >
                    <ArrowUp className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(event) => {
                      event.stopPropagation();
                      moveBlock(block.id, 1);
                    }}
                    disabled={isLast}
                    data-testid={`button-move-block-down-${block.id}`}
                  >
                    <ArrowDown className="w-4 h-4" />
                  </Button>
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
              </div>
              <div className="text-xs text-muted-foreground mt-1">ID: {block.id}</div>
            </Card>
              );
            })()
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
          <div className="space-y-2">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Listing Card Style</div>
              <Select
                value={selectedGridStyle}
                onValueChange={(value) => updateSelectedBlockData({ style: normalizeGridStyle(value) })}
              >
                <SelectTrigger data-testid="select-grid-style">
                  <SelectValue placeholder="Select card style" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="classic">Classic Card</SelectItem>
                  <SelectItem value="minimal">Minimal List</SelectItem>
                  <SelectItem value="spotlight">Spotlight Card</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">Listings</div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={addSelectedGridItem}
                data-testid="button-add-grid-listing"
              >
                <Plus className="w-4 h-4 mr-1" />
                Add Listing
              </Button>
            </div>

            {selectedGridItems.length === 0 && (
              <Card className="p-3 text-xs text-muted-foreground">
                Add at least one listing card.
              </Card>
            )}

            {selectedGridItems.map((item, index) => (
              <Card key={`${selectedBlock.id}-listing-${index}`} className="p-2 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium">Listing {index + 1}</div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => moveSelectedGridItem(index, -1)}
                      disabled={index === 0}
                      data-testid={`button-move-grid-listing-up-${index}`}
                    >
                      <ArrowUp className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => moveSelectedGridItem(index, 1)}
                      disabled={index === selectedGridItems.length - 1}
                      data-testid={`button-move-grid-listing-down-${index}`}
                    >
                      <ArrowDown className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeSelectedGridItem(index)}
                      data-testid={`button-remove-grid-listing-${index}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <Input
                  placeholder="Address"
                  value={item.address}
                  onChange={(event) => upsertSelectedGridItem(index, { address: event.target.value })}
                  data-testid={`input-grid-listing-address-${index}`}
                />
                <Input
                  placeholder="Price"
                  value={item.price}
                  onChange={(event) => upsertSelectedGridItem(index, { price: event.target.value })}
                  data-testid={`input-grid-listing-price-${index}`}
                />
                <Input
                  placeholder="Details (beds/baths/sqft)"
                  value={item.details}
                  onChange={(event) => upsertSelectedGridItem(index, { details: event.target.value })}
                  data-testid={`input-grid-listing-details-${index}`}
                />
                <Input
                  placeholder="Image URL"
                  value={item.imageUrl || ""}
                  onChange={(event) => upsertSelectedGridItem(index, { imageUrl: event.target.value })}
                  data-testid={`input-grid-listing-image-${index}`}
                />
                <Input
                  placeholder="Listing URL"
                  value={item.href || ""}
                  onChange={(event) => upsertSelectedGridItem(index, { href: event.target.value })}
                  data-testid={`input-grid-listing-link-${index}`}
                />
              </Card>
            ))}
          </div>
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
