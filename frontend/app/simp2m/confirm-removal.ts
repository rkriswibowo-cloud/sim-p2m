export async function confirmRemoval(title: string, text: string) {
  const { default: Swal } = await import("sweetalert2");
  const theme = document.querySelector<HTMLElement>(".workspace-shell")?.dataset.mode === "light" ? "light" : "dark";
  const result = await Swal.fire({
    titleText: title,
    text,
    theme,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Hapus",
    cancelButtonText: "Batal",
    confirmButtonColor: "#b53035",
    focusCancel: true,
    reverseButtons: true,
  });
  return result.isConfirmed;
}
export const workspaceToastOptions = { toasterId: "workspace" };

