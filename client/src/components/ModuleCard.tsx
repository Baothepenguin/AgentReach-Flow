import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GripVertical, Lock, Pencil, Trash2 } from "lucide-react";
import { MODULE_TYPE_LABELS, MODULE_TYPE_COLORS, type ModuleType } from "@/lib/types";
import type { NewsletterModule } from "@shared/schema";

interface ModuleCardProps {
  module: NewsletterModule;
  isSelected?: boolean;
  isDragging?: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  dragHandleProps?: Record<string, unknown>;
}

export function ModuleCard({
  module,
  isSelected,
  isDragging,
  onSelect,
  onEdit,
  onDelete,
  dragHandleProps,
}: ModuleCardProps) {
  const moduleType = module.type as ModuleType;
  const colorClass = MODULE_TYPE_COLORS[moduleType] || "border-l-gray-400";

  return (
    <div
      data-testid={`module-card-${module.id}`}
      onClick={onSelect}
      className={cn(
        "relative flex items-stretch rounded-r-lg border-l-4 bg-card transition-all cursor-pointer group",
        colorClass,
        isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        isDragging && "opacity-50 shadow-lg"
      )}
    >
      <div
        {...dragHandleProps}
        className="flex items-center px-1 cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground"
      >
        <GripVertical className="w-4 h-4" />
      </div>
      <div className="flex-1 p-3 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">
            {MODULE_TYPE_LABELS[moduleType] || module.type}
          </span>
          {module.locked && (
            <Lock className="w-3 h-3 text-muted-foreground flex-shrink-0" />
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1 truncate font-mono">
          {module.id}
        </p>
      </div>
      <div className="flex items-center gap-1 pr-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          size="icon"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          data-testid={`button-edit-module-${module.id}`}
          disabled={module.locked}
        >
          <Pencil className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          data-testid={`button-delete-module-${module.id}`}
          disabled={module.locked}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
