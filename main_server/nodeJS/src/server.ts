import express from "express"; 
import {type Request,type Response} from "express";
import multer from "multer";
import { getVersionInfo} from "./cache.js";
import { type VersionInfo } from "./cache.js";

const app = express();
const upload = multer({ dest: "../torrent_store/"});

// Middleware to authenicate
app.use(express.json());    
const authenticate = (req: Request, res: Response, next: Function) => {
    // Implement your authentication logic here

    next();
};

app.get("/", (req:Request, res: Response) => {
  res.send("Alive");
});

app.get("/latest", (req:Request, res: Response) => {
    const {software_id, version_id} = req.query;
    getVersionInfo(software_id as string).then((versionInfo : VersionInfo | undefined) => {
        if (!versionInfo) {
            res.status(404).json({sucess:false,message:"Software not found"});
            return;
        }

        if (versionInfo.version_id !== version_id) {
            // console.log(versionInfo.version_id, version_id);
            res.status(200).json({
                sucess:true,
                update_available: true,
                "version_id": versionInfo.version_id,
            });
            return;
        }

        res.status(200).json({sucess:true, update_available : false});

    }).catch((err: Error) => {
        console.error(err);
        res.status(500).json({sucess:false,message:"Internal Server Error"});
    }); 
})

app.get("/download", async(req:Request, res: Response) => {
    const {software_id, version_id} = req.query;

    getVersionInfo(software_id as string).then((info: VersionInfo | undefined) => {

        if (!info) {
            console.log("info",info);
            res.status(404).json({sucess:false,message:"Software not found"});
            return;
        }

        if (info.version_id !== version_id) {
            res.status(404).json({sucess:false, message:"Version not found"});
            return;
        }

        const filePath = info.torrent_file;

        res.download(filePath, (err: Error | undefined) => {
            if (err) {
                // console.error(err);
                console.log("Error sending file:", err);
                res.status(500).json({sucess:false, message:"Internal Server Error"});
            }
        });
    }).catch((err: Error) => {
        console.error(err);
        res.status(500).json({sucess:false,message:"Internal Server Error"});
    });
    
});

app.post("/upload/latest", authenticate, upload.single('software'), (req:Request, res: Response) => {
    
    console.log("Files uploaded:", req.file);
    if(req.file === undefined){
        res.status(400).json({sucess:false,message:"No sufficient files uploaded"});
        return;
    }
    res.send({sucess:true,software_id: req.file.filename  ,message: "Updated software uploaded successfully"});
    
})

app.post("/upload/base", authenticate, upload.single('software'), async (req:Request, res: Response) => {
    if(req.file === undefined){
        res.status(400).json({sucess:false,message:"No sufficient files uploaded"});
        return;
    }
    await addToVersionFile(req.file.filename);
    res.send({sucess:true,software_id: req.file.filename  ,message: "Base software uploaded successfully"});
});

app.delete("/delete", authenticate, (req:Request, res: Response) => {
    const {software_id} = req.query;
    if(!software_id){
        res.status(400).json({sucess:false,message:"Software ID is required"});
        return;
    }
    
    // Implement your delete logic here

    res.send({sucess:true,message: `Software with ID ${software_id} deleted successfully`});
});

app.listen(3000, () => {
  console.log("Server is running on port 3000");
});