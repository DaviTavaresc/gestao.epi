import { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, forwardRef, ReactNode } from "react";
import clsx from "clsx";

type FieldWrapperProps = { label?: string; error?: string; hint?: string; children: ReactNode; required?: boolean };

export function FieldWrapper({ label, error, hint, children, required }: FieldWrapperProps) {
  return (
    <label className="block text-sm">
      {label && (
        <span className="mb-1 block font-medium text-slate-700">
          {label} {required && <span className="text-red-500">*</span>}
        </span>
      )}
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

const baseInputClasses =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-100 disabled:bg-slate-50 disabled:text-slate-400";

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string; hint?: string; required?: boolean };
export const Input = forwardRef<HTMLInputElement, InputProps>(({ label, error, hint, required, className, ...props }, ref) => (
  <FieldWrapper label={label} error={error} hint={hint} required={required}>
    <input ref={ref} className={clsx(baseInputClasses, error && "border-red-400", className)} {...props} />
  </FieldWrapper>
));
Input.displayName = "Input";

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; error?: string; hint?: string; required?: boolean };
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ label, error, hint, required, className, ...props }, ref) => (
  <FieldWrapper label={label} error={error} hint={hint} required={required}>
    <textarea ref={ref} className={clsx(baseInputClasses, "min-h-[80px]", error && "border-red-400", className)} {...props} />
  </FieldWrapper>
));
Textarea.displayName = "Textarea";

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { label?: string; error?: string; hint?: string; required?: boolean; children: ReactNode };
export const Select = forwardRef<HTMLSelectElement, SelectProps>(({ label, error, hint, required, className, children, ...props }, ref) => (
  <FieldWrapper label={label} error={error} hint={hint} required={required}>
    <select ref={ref} className={clsx(baseInputClasses, error && "border-red-400", className)} {...props}>
      {children}
    </select>
  </FieldWrapper>
));
Select.displayName = "Select";
