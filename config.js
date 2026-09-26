// Einstellungen für die Google-Drive-Synchronisierung.
// googleClientId: OAuth-Client-ID vom Typ „Webanwendung“ (siehe README → „Google Drive einrichten“).
// Die Client-ID ist kein Geheimnis und darf öffentlich im Code stehen.
// Solange sie leer ist, arbeitet die App nur lokal. Sie lässt sich auch in den Einstellungen der App eintragen.
export const CONFIG = {
  googleClientId: '423369023138-1sgo2mpi8pa7cp81c1e4kb1ftjsm5rt8.apps.googleusercontent.com',
  driveFolderName: 'Finanzverwaltung',
  driveFileName: 'finanzdaten.json',
};
