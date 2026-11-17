import next from "eslint-config-next";

export default [
  ...next,
  {
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
];
