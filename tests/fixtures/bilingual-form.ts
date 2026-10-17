// A small bilingual form for the cases the Spanish-only reference form cannot cover, such as
// the language switch. One page, one optional number field that is not personal data, so it
// publishes without consent text. All text is synthetic.

export const bilingualFormDraft = {
  languages: "bilingual",
  title: { en: "Plant count", es: "Conteo de plantas" },
  pages: [
    {
      key: "page1",
      title: { en: "Your plants", es: "Tus plantas" },
      fields: [
        {
          key: "plants",
          type: "number",
          label: { en: "How many plants do you have?", es: "¿Cuántas plantas tienes?" },
        },
      ],
    },
  ],
  confirmation: { screen: { en: "Thank you.", es: "Gracias." } },
};
