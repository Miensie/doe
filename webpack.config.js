const HtmlWebpackPlugin    = require("html-webpack-plugin");
const CopyWebpackPlugin    = require("copy-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const path = require("path");

const isProd     = process.env.NODE_ENV === "production";
const REPO_NAME  = process.env.REPO_NAME || "";
const publicPath = isProd && REPO_NAME ? `/${REPO_NAME}/` : "/";

module.exports = {
  entry: { taskpane: "./src/taskpane/taskpane.js", commands: "./src/commands/commands.js" },
  output: { path: path.resolve(__dirname, "dist"), filename: "[name].js", publicPath, clean: true },
  resolve: { extensions: [".js"] },
  module: {
    rules: [
      { test: /\.js$/,  use: "babel-loader", exclude: /node_modules/ },
      { test: /\.css$/, use: [isProd ? MiniCssExtractPlugin.loader : "style-loader", "css-loader"] },
      { test: /\.(png|svg|ico)$/, type: "asset/resource" },
    ],
  },
  plugins: [
    ...(isProd ? [new MiniCssExtractPlugin({ filename: "[name].css" })] : []),
    new HtmlWebpackPlugin({ filename: "taskpane.html", template: "./src/taskpane/taskpane.html", chunks: ["taskpane"], inject: true }),
    new HtmlWebpackPlugin({ filename: "commands.html", template: "./src/taskpane/commands.html", chunks: ["commands"], inject: true }),
    new CopyWebpackPlugin({ patterns: [
      { from: "src/assets", to: "assets", noErrorOnMissing: true },
      { from: "manifest.xml", to: "manifest.xml" },
    ]}),
  ],
  devServer: {
    port: 3000, hot: true,
    headers: { "Access-Control-Allow-Origin": "*" },
    server: {
      type: "https",
      options: {
        ca:   `${process.env.USERPROFILE}/.office-addin-dev-certs/ca.crt`,
        key:  `${process.env.USERPROFILE}/.office-addin-dev-certs/localhost.key`,
        cert: `${process.env.USERPROFILE}/.office-addin-dev-certs/localhost.crt`,
      },
    },
  },
};
