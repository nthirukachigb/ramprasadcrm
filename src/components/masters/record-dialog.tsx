"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { FORMS, type SelectOption } from "@/components/masters/forms";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface RecordDialogProps {
  formKey: keyof typeof FORMS | string;
  defaults?: Record<string, unknown>;
  options?: Record<string, SelectOption[]>;
  triggerVariant?: "default" | "outline" | "secondary" | "ghost";
  triggerSize?: "default" | "sm" | "lg";
}

type FormValues = Record<string, unknown>;

export function RecordDialog({
  formKey,
  defaults,
  options,
  triggerVariant = "default",
  triggerSize = "sm",
}: RecordDialogProps) {
  const spec = FORMS[formKey];
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const initialValues: FormValues = {};
  if (spec) {
    for (const field of spec.fields) {
      initialValues[field.name] =
        field.type === "checkbox"
          ? false
          : field.type === "checkboxGroup"
            ? []
            : "";
    }
    Object.assign(initialValues, defaults ?? {});
  }

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<FormValues>({ defaultValues: initialValues });

  if (!spec) {
    return null;
  }

  function resolveOptions(field: (typeof spec.fields)[number]): SelectOption[] {
    if (field.optionsKey) return options?.[field.optionsKey] ?? [];
    return field.options ?? [];
  }

  async function onSubmit(values: FormValues) {
    setFormError(null);
    const result = await spec.action(values);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    toast.success(`${spec.title} saved`);
    setOpen(false);
    reset(initialValues);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size={triggerSize}>
          {spec.triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{spec.title}</DialogTitle>
            {spec.description ? (
              <DialogDescription>{spec.description}</DialogDescription>
            ) : null}
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            {spec.fields.map((field) => {
              if (field.type === "hidden") {
                return (
                  <input
                    key={field.name}
                    type="hidden"
                    {...register(field.name)}
                  />
                );
              }

              return (
                <div
                  key={field.name}
                  className={cn(
                    "space-y-1.5",
                    field.fullWidth && "sm:col-span-2",
                  )}
                >
                  <Label htmlFor={`${formKey}-${field.name}`}>
                    {field.label}
                  </Label>

                  {field.type === "textarea" ? (
                    <Textarea
                      id={`${formKey}-${field.name}`}
                      placeholder={field.placeholder}
                      {...register(field.name)}
                    />
                  ) : field.type === "select" ? (
                    <select
                      id={`${formKey}-${field.name}`}
                      className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                      {...register(field.name)}
                    >
                      {field.optionsKey ? (
                        <option value="">— none —</option>
                      ) : null}
                      {resolveOptions(field).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : field.type === "checkbox" ? (
                    <div className="flex h-9 items-center">
                      <input
                        id={`${formKey}-${field.name}`}
                        type="checkbox"
                        className="size-4 rounded border"
                        {...register(field.name)}
                      />
                    </div>
                  ) : field.type === "checkboxGroup" ? (
                    <Controller
                      control={control}
                      name={field.name}
                      render={({ field: controlled }) => (
                        <div className="grid grid-cols-2 gap-1.5 pt-1">
                          {resolveOptions(field).map((option) => {
                            const current = (controlled.value as string[]) ?? [];
                            return (
                              <label
                                key={option.value}
                                className="flex items-center gap-2 text-sm"
                              >
                                <input
                                  type="checkbox"
                                  className="size-4 rounded border"
                                  checked={current.includes(option.value)}
                                  onChange={(event) => {
                                    const next = new Set(current);
                                    if (event.target.checked) {
                                      next.add(option.value);
                                    } else {
                                      next.delete(option.value);
                                    }
                                    controlled.onChange(Array.from(next));
                                  }}
                                />
                                {option.label}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    />
                  ) : (
                    <Input
                      id={`${formKey}-${field.name}`}
                      type={
                        field.type === "number"
                          ? "number"
                          : field.type === "date"
                            ? "date"
                            : "text"
                      }
                      step={field.type === "number" ? "any" : undefined}
                      placeholder={field.placeholder}
                      {...register(field.name)}
                    />
                  )}

                  {field.help ? (
                    <p className="text-muted-foreground text-xs">{field.help}</p>
                  ) : null}
                </div>
              );
            })}
          </div>

          {formError ? (
            <p role="alert" className="text-destructive text-sm">
              {formError}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              {spec.submitLabel ?? "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
