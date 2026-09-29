import { register } from "../../shared/hub";
import { VerifTool } from "./VerifTool";
import "./styles.css";

register("verif-liens", { Tool: VerifTool });
