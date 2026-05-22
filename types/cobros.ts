// types/cobros.ts
// Fuente de verdad del modelo de datos. Si cambian los nombres en Redshift o en
// Salesforce, SOLO se toca aquí. Todo lo demás (filtros, tabla, descarga) lo lee
// de aquí.

export interface CasoCobro {
  // --- Caso ---
  casoId: string;
  numeroCaso: string;
  fechaApertura: string;
  fechaCierre: string;
  status: string;
  subEstado: string;
  subTipoCaso: string;
  motivoNoPago: string;
  motivoNoAdelanto: string;
  gestor: string;
  propietario: string;
  noLlamar: boolean;
  idAcuerdoPago: string;
  acuerdoUpsell: boolean;
  diasAbierto: number;
  abierto: boolean;
  // --- Estudiante ---
  studentId: string;
  correoElectronico: string;
  pais: string;
  frecuenciaSuscripcion: string;
  fechaRenovacion: string;
  // --- Factura / Invoice ---
  invoiceFactNumber: string;
  fechaPago: string;
  tipoOportunidad: string;
  statusInvFact: string;
  paymentAmountUsd: number;
  totalAmountUsd: number;
  balanceUsd: number;
  // --- Suscripción ---
  subscription: string;
  subscriptionStatus: string;
  origen: "redshift" | "salesforce";
}

export interface DefColumna {
  key: keyof CasoCobro;
  label: string;
  redshift: string;        // alias en la salida del CTE cobros_base
  soql: string;            // nombre del campo en Salesforce (vacío = no disponible directo)
  tipo: "texto" | "numero" | "fecha" | "booleano";
  descargable: boolean;
}

export const COLUMNAS: DefColumna[] = [
  { key: "casoId",                label: "ID Caso",               redshift: "caseid",                   soql: "Id",                     tipo: "texto",    descargable: true  },
  { key: "numeroCaso",            label: "# Caso",                redshift: "numero_caso",              soql: "CaseNumber",             tipo: "texto",    descargable: true  },
  { key: "fechaApertura",         label: "Fecha Apertura",        redshift: "fecha_hora_apertura_real", soql: "CreatedDate",            tipo: "fecha",    descargable: true  },
  { key: "fechaCierre",           label: "Fecha Cierre",          redshift: "fecha_hora_cierre_real",   soql: "ClosedDate",             tipo: "fecha",    descargable: true  },
  { key: "status",                label: "Status",                redshift: "status",                   soql: "Status",                 tipo: "texto",    descargable: true  },
  { key: "subEstado",             label: "Sub Estado",            redshift: "sub_estado",               soql: "Sub_Estado__c",          tipo: "texto",    descargable: true  },
  { key: "subTipoCaso",           label: "Subtipo Caso",          redshift: "sub_tipo_caso",            soql: "Sub_Tipo_Caso__c",       tipo: "texto",    descargable: true  },
  { key: "motivoNoPago",          label: "Motivo No Pago",        redshift: "motivo_no_pago",           soql: "Motivo_No_Pago__c",      tipo: "texto",    descargable: true  },
  { key: "motivoNoAdelanto",      label: "Motivo No Adelanto",    redshift: "motivo_no_adelanto",       soql: "Motivo_No_Adelanto__c",  tipo: "texto",    descargable: true  },
  { key: "gestor",                label: "Gestor",                redshift: "gestor",                   soql: "Gestor__c",              tipo: "texto",    descargable: true  },
  { key: "propietario",           label: "Propietario",           redshift: "propietario",              soql: "Owner.Name",             tipo: "texto",    descargable: true  },
  { key: "noLlamar",              label: "No Llamar",             redshift: "no_llamar",                soql: "No_Llamar__c",           tipo: "booleano", descargable: true  },
  { key: "idAcuerdoPago",         label: "ID Acuerdo Pago",       redshift: "id_acuerdo_pago",          soql: "Id_Acuerdo_Pago__c",     tipo: "texto",    descargable: true  },
  { key: "acuerdoUpsell",         label: "Acuerdo Upsell",        redshift: "acuerdo_upsell",           soql: "Acuerdo_Upsell__c",      tipo: "booleano", descargable: true  },
  { key: "diasAbierto",           label: "Días Abierto",          redshift: "dias_abierto",             soql: "Dias_Abierto__c",        tipo: "numero",   descargable: true  },
  { key: "abierto",               label: "Abierto",               redshift: "abierto",                  soql: "",                       tipo: "booleano", descargable: false },
  { key: "studentId",             label: "Student ID",            redshift: "student_id",               soql: "Student_ID__c",          tipo: "texto",    descargable: true  },
  { key: "correoElectronico",     label: "Correo",                redshift: "correo_electronico",       soql: "",                       tipo: "texto",    descargable: true  },
  { key: "pais",                  label: "País",                  redshift: "pais",                     soql: "Pais_Lead__c",           tipo: "texto",    descargable: true  },
  { key: "frecuenciaSuscripcion", label: "Frecuencia Suscripción",redshift: "frecuencia_suscripcion",   soql: "",                       tipo: "texto",    descargable: true  },
  { key: "fechaRenovacion",       label: "Fecha Renovación",      redshift: "fecha_renovacion",         soql: "",                       tipo: "fecha",    descargable: true  },
  { key: "invoiceFactNumber",     label: "# Factura / Invoice",   redshift: "invoice_fact_number",      soql: "",                       tipo: "texto",    descargable: true  },
  { key: "fechaPago",             label: "Fecha Pago",            redshift: "fecha_pago",               soql: "",                       tipo: "fecha",    descargable: true  },
  { key: "tipoOportunidad",       label: "Tipo Oportunidad",      redshift: "tipo_oportunidad",         soql: "",                       tipo: "texto",    descargable: true  },
  { key: "statusInvFact",         label: "Status Fact/Inv",       redshift: "status_inv_fact",          soql: "",                       tipo: "texto",    descargable: true  },
  { key: "paymentAmountUsd",      label: "Monto Pago USD",        redshift: "payment_amount_usd",       soql: "",                       tipo: "numero",   descargable: true  },
  { key: "totalAmountUsd",        label: "Total USD",             redshift: "total_amount_usd",         soql: "",                       tipo: "numero",   descargable: true  },
  { key: "balanceUsd",            label: "Balance USD",           redshift: "balance_usd",              soql: "",                       tipo: "numero",   descargable: true  },
  { key: "subscription",          label: "Suscripción",           redshift: "subscription",             soql: "",                       tipo: "texto",    descargable: true  },
  { key: "subscriptionStatus",    label: "Status Suscripción",    redshift: "subscription_status",      soql: "",                       tipo: "texto",    descargable: true  },
  { key: "origen",                label: "Origen",                redshift: "'redshift'",               soql: "Id",                     tipo: "texto",    descargable: true  },
];

export const colPorKey = (k: string) => COLUMNAS.find((c) => c.key === k);
export const columnasDescargables = () => COLUMNAS.filter((c) => c.descargable);

export interface FiltrosCobros {
  fechaDesde?: string;    // YYYY-MM-DD
  fechaHasta?: string;    // YYYY-MM-DD
  gestor?: string[];
  subtipo?: string[];
  busqueda?: string;      // correo, ID de caso o número de caso
}
