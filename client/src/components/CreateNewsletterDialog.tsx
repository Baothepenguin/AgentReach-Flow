import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Loader2 } from "lucide-react";

const createNewsletterSchema = z.object({
  title: z.string().min(1, "Title is required"),
  periodStart: z.string().min(1, "Month is required"),
});

type CreateNewsletterForm = z.infer<typeof createNewsletterSchema>;

interface CreateNewsletterDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: CreateNewsletterForm) => Promise<void>;
  isSubmitting?: boolean;
  clientName?: string;
}

export function CreateNewsletterDialog({
  open,
  onClose,
  onSubmit,
  isSubmitting,
  clientName,
}: CreateNewsletterDialogProps) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  
  const form = useForm<CreateNewsletterForm>({
    resolver: zodResolver(createNewsletterSchema),
    defaultValues: {
      title: "",
      periodStart: currentMonth,
    },
  });

  const handleSubmit = async (data: CreateNewsletterForm) => {
    await onSubmit({
      ...data,
      periodStart: `${data.periodStart}-01`,
    });
    form.reset();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Newsletter</DialogTitle>
          <DialogDescription>
            {clientName ? `Start a new newsletter for ${clientName}` : "Start a new newsletter"}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Newsletter Title</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="January 2025 Newsletter"
                      data-testid="input-newsletter-title"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="periodStart"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Newsletter Month</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="month"
                      data-testid="input-newsletter-month"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting} data-testid="button-submit-newsletter">
                {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Create Newsletter
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
