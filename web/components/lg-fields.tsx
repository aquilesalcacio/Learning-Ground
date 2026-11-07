"use client";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COLOR_HEX, type Option, type PenColor } from "@/lib/lg-types";

export function MockBadge({ label = "Mocked" }: { label?: string }) {
  return <Badge variant="outline">{label}</Badge>;
}

export function FieldSelect<T extends string>({
  id,
  label,
  value,
  options,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: T | "";
  options: Option<T>[];
  placeholder: string;
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        items={options}
        value={value === "" ? null : value}
        onValueChange={(next) => {
          if (next) onChange(next as T);
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ColorSwatches<T extends PenColor>({
  label,
  colors,
  value,
  onChange,
}: {
  label: string;
  colors: T[];
  value: T;
  onChange: (color: T) => void;
}) {
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={color}
            aria-pressed={color === value}
            onClick={() => onChange(color)}
            className="size-8 rounded-full border-2 border-background ring-offset-2 aria-pressed:ring-2 aria-pressed:ring-foreground"
            style={{ backgroundColor: COLOR_HEX[color] }}
          />
        ))}
      </div>
    </div>
  );
}
