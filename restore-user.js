const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

const serviceAccount = require("./serviceAccountKey.json");

initializeApp({
    credential: cert(serviceAccount)
});

const uid = "zbDEZ5ybtnaO1KMXNj7pStdW5Xn2";
const email = "isaacagbonagban664@gmail.com";

// Choisis ici un NOUVEAU mot de passe temporaire.
// Tu pourras le changer ensuite.
const password = "12345678";

async function restoreUser() {
    try {
        const user = await getAuth().createUser({
            uid: uid,
            email: email,
            password: password,
            emailVerified: true
        });

        console.log("=================================");
        console.log("UTILISATEUR RECRÉÉ");
        console.log("=================================");
        console.log("UID :", user.uid);
        console.log("Email :", user.email);
        console.log("Email vérifié :", user.emailVerified);

    } catch (error) {
        console.log("=================================");
        console.log("ERREUR");
        console.log("=================================");
        console.log("Code :", error.code);
        console.log("Message :", error.message);
    }
}

restoreUser();