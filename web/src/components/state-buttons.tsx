import { setFavorite, setRead } from "@/app/actions"

const btn =
  "rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900 " +
  "dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"

// Plain <form> + Server Action: works without client-side JavaScript.
export function ReadButton({ id, read }: { id: number; read: boolean }) {
  return (
    <form action={setRead}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="read" value={read ? "0" : "1"} />
      <button type="submit" className={btn} aria-pressed={read}>
        {read ? "✓ Leído" : "Marcar leído"}
      </button>
    </form>
  )
}

export function FavoriteButton({ id, favorite }: { id: number; favorite: boolean }) {
  return (
    <form action={setFavorite}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="favorite" value={favorite ? "0" : "1"} />
      <button
        type="submit"
        className={`${btn} ${favorite ? "text-amber-600 dark:text-amber-400" : ""}`}
        aria-pressed={favorite}
        aria-label={favorite ? "Quitar de favoritos" : "Añadir a favoritos"}
      >
        {favorite ? "★ Favorito" : "☆ Favorito"}
      </button>
    </form>
  )
}
