export const LIMITS = {
  pagesPerForm: 20,
  inputFieldsPerPage: 15,
  inputFieldsPerPageWarn: 7,
  optionsPerChoice: 50,
  shortTextMax: 5_000,
  longTextMax: 20_000,
  filesPerField: 10,
  fileSizeMb: 10,
  submissionSizeMb: 100,
  retentionMonthsMin: 1,
  retentionMonthsMax: 36,
  retentionMonthsDefault: 12,
} as const;
