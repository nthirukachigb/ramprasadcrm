export interface ImportTemplate {
  code: string;
  label: string;
  targetEntity: string;
  synonyms: Record<string, string[]>;
  scaleFactors?: Record<string, number>;
}

const common = {
  customer: ["customer", "customer name", "client", "customer/agency"],
  partNumber: ["part no", "part number", "part no.", "part no (customer)", "item code"],
  description: ["description", "item description", "product description", "item"],
  quantity: ["qty", "quantity", "qty (nos)", "qty (mtrs)", "qty (mtr)"],
  uom: ["uom", "unit", "qty uom", "qty (nos)", "qty (mtrs)"],
  rate: ["rate", "unit rate", "price", "unit price"],
  date: ["date", "enquiry date", "po date", "invoice date", "due date"],
  reference: ["ref", "reference", "enquiry no", "po no", "invoice no"],
};

export const IMPORT_TEMPLATES: ImportTemplate[] = [
  { code: "ENQ_MASTER", label: "Enquiry master", targetEntity: "requirement", synonyms: common },
  { code: "ENQ_MASTER_POS", label: "Enquiry master POs", targetEntity: "customer_po", synonyms: common, scaleFactors: { value: 100000 } },
  { code: "QTN_LIST", label: "Quotation list", targetEntity: "quotation", synonyms: common },
  { code: "ORDER_BOOK", label: "Order book", targetEntity: "customer_po", synonyms: common },
  { code: "SALES_REG", label: "Sales register", targetEntity: "invoice", synonyms: common, scaleFactors: { crore: 10000000 } },
  { code: "PAYMENT_MASTER", label: "Payment master", targetEntity: "payment", synonyms: common },
  { code: "APPROVALS", label: "Approvals", targetEntity: "compliance_approval", synonyms: common },
  { code: "OEM_MASTER", label: "OEM master", targetEntity: "partner", synonyms: common },
  { code: "CUSTOMER_MASTER", label: "Customer master", targetEntity: "customer", synonyms: common },
  {
    code: "LINES_GENERIC",
    label: "Requirement lines",
    targetEntity: "requirement_line",
    synonyms: {
      partNumber: common.partNumber,
      description: common.description,
      quantity: common.quantity,
      uom: common.uom,
      requiredDeliveryDate: ["required delivery date", "delivery date", "required by"],
      specificationRef: ["specification", "spec ref", "drawing"],
    },
  },
];

export function getImportTemplate(code: string): ImportTemplate | undefined {
  return IMPORT_TEMPLATES.find((template) => template.code === code);
}
