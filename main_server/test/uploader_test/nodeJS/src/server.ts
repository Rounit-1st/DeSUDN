import express from "express"; 
import {type Request,type Response} from "express";

const app = express();

app.get("/", (req:Request, res: Response) => {
  res.send("Alive");
});

app.get("/latest", (req:Request, res: Response) => {
    const {software,version} = req.query;
    if (software === "software-001" && version === "2.4.1") {
        res.json({latestVersion: "2.4.1"});
    } else {
        res.status(404).json({error: "Software not found"});
    }
})

app.get("/download/:software/:version", (req:Request, res: Response) => {
    const {software, version} = req.params;
    if (software === "software-001" && version === "2.4.1") {
        res.download("./update/software-001_v2.4.1.zip");
    } else {
        res.status(404).json({error: "File not found"});
    }
}

app.listen(3000, () => {
  console.log("Server is running on port 3000");
});