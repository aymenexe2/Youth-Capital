import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { usePeople, type Person } from "@/hooks/use-org";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PersonAvatar } from "./primitives";

const NONE = "__none";

// Radix Select can't hold an empty value, so "nothing selected" maps to a sentinel.
export function OptionSelect({ value, onChange, options, placeholder, allowNone, noneLabel, id, className }: {
  value: string | number | null | undefined;
  onChange: (v: string | null) => void;
  options: { value: string | number; label: string }[];
  placeholder?: string;
  allowNone?: boolean;
  noneLabel?: string;
  id?: string;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <Select value={value == null || value === "" ? (allowNone ? NONE : undefined) : String(value)} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger id={id} className={cn("w-full", className)}><SelectValue placeholder={placeholder ?? t("Select…")} /></SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>{noneLabel ?? t("None")}</SelectItem>}
        {options.map((o) => <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

// Searchable member picker backed by the organisation's people directory.
export function PersonPicker({ value, onChange, placeholder, exclude = [], allowClear = true, id, people: override }: {
  value: number | null | undefined;
  onChange: (id: number | null) => void;
  placeholder?: string;
  exclude?: (number | null | undefined)[];
  allowClear?: boolean;
  id?: string;
  people?: Person[];
}) {
  const { t } = useI18n();
  const { people: all, byId } = usePeople();
  const people = override ?? all;
  const [open, setOpen] = useState(false);
  const selected = value ? byId.get(value) : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {selected ? (
            <>
              <PersonAvatar name={selected.fullName} url={selected.avatarUrl} size={20} />
              <span className="truncate">{selected.fullName}</span>
            </>
          ) : (
            <span className="text-muted-foreground">{placeholder ?? t("Choose a person")}</span>
          )}
          <span className="ms-auto flex items-center gap-1">
            {selected && allowClear && (
              <span
                role="button"
                tabIndex={0}
                aria-label={t("Clear")}
                onClick={(e) => { e.stopPropagation(); onChange(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onChange(null); } }}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted"
              >
                <X className="size-3.5" />
              </span>
            )}
            <ChevronsUpDown className="size-3.5 text-muted-foreground" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={t("Search people…")} />
          <CommandList>
            <CommandEmpty>{t("No one found.")}</CommandEmpty>
            <CommandGroup>
              {people.filter((p) => !exclude.includes(p.membershipId)).map((p) => (
                <CommandItem key={p.membershipId} value={`${p.fullName} ${p.title ?? ""} ${p.membershipId}`} onSelect={() => { onChange(p.membershipId); setOpen(false); }}>
                  <PersonAvatar name={p.fullName} url={p.avatarUrl} size={22} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{p.fullName}</span>
                    {p.title && <span className="block truncate text-xs text-muted-foreground">{p.title}</span>}
                  </span>
                  {value === p.membershipId && <Check className="size-4 text-primary" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
