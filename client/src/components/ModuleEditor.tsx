import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, Plus, Trash2 } from "lucide-react";
import type { NewsletterModule } from "@shared/schema";

interface ModuleEditorProps {
  module: NewsletterModule | null;
  open: boolean;
  onClose: () => void;
  onSave: (module: NewsletterModule) => void;
}

export function ModuleEditor({ module, open, onClose, onSave }: ModuleEditorProps) {
  if (!module) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Edit {module.type}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-4 pr-4">
            <ModulePropsForm module={module} onSave={onSave} onClose={onClose} />
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function ModulePropsForm({
  module,
  onSave,
  onClose,
}: {
  module: NewsletterModule;
  onSave: (module: NewsletterModule) => void;
  onClose: () => void;
}) {
  const { register, handleSubmit, watch, setValue } = useForm({
    defaultValues: module.props as Record<string, unknown>,
  });

  const onSubmit = (data: Record<string, unknown>) => {
    onSave({ ...module, props: data } as NewsletterModule);
    onClose();
  };

  const renderFields = () => {
    switch (module.type) {
      case "Hero":
        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input id="title" {...register("title")} data-testid="input-hero-title" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subtitle">Subtitle</Label>
              <Input id="subtitle" {...register("subtitle")} data-testid="input-hero-subtitle" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="backgroundUrl">Background Image URL</Label>
              <Input id="backgroundUrl" {...register("backgroundUrl")} data-testid="input-hero-bg" />
            </div>
          </>
        );
      case "RichText":
        return (
          <div className="space-y-2">
            <Label htmlFor="content">Content</Label>
            <Textarea
              id="content"
              {...register("content")}
              className="min-h-[200px]"
              data-testid="input-richtext-content"
            />
          </div>
        );
      case "CTA":
        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="headline">Headline</Label>
              <Input id="headline" {...register("headline")} data-testid="input-cta-headline" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="buttonText">Button Text</Label>
              <Input id="buttonText" {...register("buttonText")} data-testid="input-cta-button" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="buttonUrl">Button URL</Label>
              <Input id="buttonUrl" {...register("buttonUrl")} data-testid="input-cta-url" />
            </div>
          </>
        );
      case "AgentBio":
        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" {...register("name")} data-testid="input-bio-name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input id="title" {...register("title")} data-testid="input-bio-title" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" {...register("email")} data-testid="input-bio-email" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" {...register("phone")} data-testid="input-bio-phone" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="photoUrl">Photo URL</Label>
              <Input id="photoUrl" {...register("photoUrl")} data-testid="input-bio-photo" />
            </div>
          </>
        );
      case "MarketUpdate":
        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="title">Section Title</Label>
              <Input id="title" {...register("title")} data-testid="input-market-title" />
            </div>
            <div className="space-y-2">
              <Label>Paragraphs</Label>
              <Textarea
                {...register("paragraphs")}
                className="min-h-[150px]"
                placeholder="Enter each paragraph on a new line"
                data-testid="input-market-paragraphs"
              />
              <p className="text-xs text-muted-foreground">One paragraph per line</p>
            </div>
          </>
        );
      case "Testimonial":
        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="quote">Quote</Label>
              <Textarea id="quote" {...register("quote")} data-testid="input-testimonial-quote" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="author">Author</Label>
              <Input id="author" {...register("author")} data-testid="input-testimonial-author" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role/Title</Label>
              <Input id="role" {...register("role")} data-testid="input-testimonial-role" />
            </div>
          </>
        );
      case "FooterCompliance":
        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="copyright">Copyright Text</Label>
              <Input id="copyright" {...register("copyright")} data-testid="input-footer-copyright" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="brokerage">Brokerage Info</Label>
              <Textarea id="brokerage" {...register("brokerage")} data-testid="input-footer-brokerage" />
            </div>
          </>
        );
      default:
        return (
          <div className="p-4 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground">
              Editor for {module.type} coming soon. Use JSON mode to edit.
            </p>
            <Textarea
              className="mt-3 font-mono text-xs"
              value={JSON.stringify(module.props, null, 2)}
              onChange={(e) => {
                try {
                  const parsed = JSON.parse(e.target.value);
                  Object.keys(parsed).forEach((key) => setValue(key, parsed[key]));
                } catch {}
              }}
              data-testid="input-module-json"
            />
          </div>
        );
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Module ID</Label>
        <code className="block text-xs bg-muted p-2 rounded font-mono">{module.id}</code>
      </div>
      {renderFields()}
      <DialogFooter className="pt-4">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" data-testid="button-save-module">
          Save Changes
        </Button>
      </DialogFooter>
    </form>
  );
}
