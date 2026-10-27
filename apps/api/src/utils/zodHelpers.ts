import { z } from "zod";

// z.coerce.boolean() usa Boolean(valor), então a string "false" viraria true.
// Formulários e multipart mandam booleano como texto, por isso a conversão é explícita.
export function booleanDoFormulario(padrao: boolean) {
  return z.preprocess((valor) => {
    if (typeof valor === "string") {
      const texto = valor.trim().toLowerCase();
      if (["false", "0", "off", "nao", "não", ""].includes(texto)) return false;
      if (["true", "1", "on", "sim"].includes(texto)) return true;
    }
    return valor;
  }, z.boolean().default(padrao));
}
