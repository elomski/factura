const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

const serviceAccount = require("./serviceAccountKey.json");

initializeApp({
    credential: cert(serviceAccount)
});

const uid = "zbDEZ5ybtnaO1KMXNj7pStdW5Xn2";
const email = "isaacagbonagban664@gmail.com";

async function checkUser() {

    console.log("=================================");
    console.log("RECHERCHE PAR UID");
    console.log("=================================");

    try {
        const user = await getAuth().getUser(uid);

        console.log("UTILISATEUR TROUVE");
        console.log("UID :", user.uid);
        console.log("Email :", user.email);
        console.log("Email vérifié :", user.emailVerified);
        console.log("Créé le :", user.metadata.creationTime);

    } catch (error) {

        console.log("UID NON TROUVE");
        console.log("Code :", error.code);
        console.log("Message :", error.message);
    }

    console.log("\n=================================");
    console.log("RECHERCHE PAR EMAIL");
    console.log("=================================");

    try {
        const user = await getAuth().getUserByEmail(email);

        console.log("UTILISATEUR TROUVE");
        console.log("UID :", user.uid);
        console.log("Email :", user.email);
        console.log("Email vérifié :", user.emailVerified);
        console.log("Créé le :", user.metadata.creationTime);

    } catch (error) {

        console.log("EMAIL NON TROUVE");
        console.log("Code :", error.code);
        console.log("Message :", error.message);
    }
}

checkUser();