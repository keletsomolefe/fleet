import type { ChangeEvent, FormEvent } from "react";

export function submitForm(form: {
  state: { isSubmitting: boolean };
  handleSubmit: () => Promise<void>;
}) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.state.isSubmitting) void form.handleSubmit();
  };
}

export function textFieldProps(field: {
  name: string;
  state: { value: string };
  handleChange: (value: string) => void;
  handleBlur: () => void;
}) {
  return {
    name: field.name,
    value: field.state.value,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      field.handleChange(event.currentTarget.value),
    onBlur: field.handleBlur,
  };
}
