// Einstellungen für die Google-Drive-Synchronisierung.
// googleClientId: OAuth-Client-ID vom Typ „Webanwendung“ (siehe README → „Google Drive einrichten“).
// Die Client-ID ist kein Geheimnis und darf öffentlich im Code stehen.
// Solange sie leer ist, arbeitet die App nur lokal. Sie lässt sich auch in den Einstellungen der App eintragen.
export const CONFIG = {
  googleClientId: '',
  driveFolderName: 'Finanzverwaltung',
  driveFileName: 'finanzdaten.json',
};
