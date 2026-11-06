// Ayudante nativo de SpiderPDF para Windows. Lo compila build/helper/build.cjs con el csc.exe de .NET Framework 4.8
// (viene con Windows; sin dependencias) y va dentro de la app. Lo lanza el proceso principal (electron/helper.cjs).
//
// Órdenes (una por ejecución; responde una línea JSON por la salida estándar, código de salida 0 si fue bien):
//   copy-file <ruta>                     el archivo al portapapeles como archivo (CF_HDROP), para pegarlo con Ctrl+V
//   mail <ruta> <asunto>                 nuevo correo con el archivo adjunto en el cliente predeterminado (MAPISendMail)
//   version                              versión del protocolo
// Más adelante, la firma con certificado añadirá sus órdenes aquí.
using System;
using System.Collections.Specialized;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("SpiderPDF helper")]
[assembly: System.Reflection.AssemblyProduct("SpiderPDF")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]

static class SpiderPdfHelper
{
    const int PROTOCOL = 1;

    static int Main(string[] args)
    {
        try
        {
            if (args.Length == 0) return Reply(false, "sin-orden", "Falta la orden.");
            switch (args[0])
            {
                case "version": return Reply(true, null, null, "\"protocol\":" + PROTOCOL);
                case "copy-file": return Need(args, 2) ?? CopyFile(args[1]);
                case "mail": return Need(args, 3) ?? Mail(args[1], args[2]);
                default: return Reply(false, "orden-desconocida", "Orden desconocida: " + args[0]);
            }
        }
        catch (Exception e)
        {
            return Reply(false, "excepcion", e.Message);
        }
    }

    static int? Need(string[] args, int n)
    {
        if (args.Length < n) return Reply(false, "faltan-datos", "Faltan datos para la orden " + args[0] + ".");
        if (!File.Exists(args[1])) return Reply(false, "no-existe", "No existe el archivo.");
        return null;
    }

    // --- Portapapeles: lista de archivos (lo que pega el Explorador, WhatsApp, Outlook, Teams…) ----------------------
    static int CopyFile(string path)
    {
        Exception error = null;
        var t = new Thread(() =>
        {
            try
            {
                var files = new StringCollection { Path.GetFullPath(path) };
                var data = new DataObject();
                data.SetFileDropList(files);
                // «Copiar» (no «cortar»): quien pegue hace una copia y el archivo sigue donde está.
                data.SetData("Preferred DropEffect", new MemoryStream(BitConverter.GetBytes(1 /* DROPEFFECT_COPY */)));
                Clipboard.SetDataObject(data, true, 10, 100); // copy: true = sigue en el portapapeles al salir
            }
            catch (Exception e) { error = e; }
        });
        t.SetApartmentState(ApartmentState.STA); // el portapapeles OLE exige STA
        t.Start();
        t.Join();
        return error == null ? Reply(true) : Reply(false, "portapapeles", error.Message);
    }

    // --- Correo: MAPISendMail (Simple MAPI) con el cliente predeterminado ------------------------------------------------
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    class MapiMessageW
    {
        public int reserved;
        public string subject;
        public string noteText;
        public string messageType;
        public string dateReceived;
        public string conversationID;
        public int flags;
        public IntPtr originator;
        public int recipCount;
        public IntPtr recips;
        public int fileCount;
        public IntPtr files;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct MapiFileDescW
    {
        public int reserved;
        public int flags;
        public int position;
        public string pathName;
        public string fileName;
        public IntPtr fileType;
    }

    [DllImport("MAPI32.DLL", CharSet = CharSet.Unicode)]
    static extern int MAPISendMailW(IntPtr session, IntPtr uiParam, MapiMessageW message, int flags, int reserved);

    [DllImport("MAPI32.DLL", CharSet = CharSet.Ansi, EntryPoint = "MAPISendMail")]
    static extern int MAPISendMailA(IntPtr session, IntPtr uiParam, MapiMessageA message, int flags, int reserved);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    class MapiMessageA
    {
        public int reserved;
        public string subject;
        public string noteText;
        public string messageType;
        public string dateReceived;
        public string conversationID;
        public int flags;
        public IntPtr originator;
        public int recipCount;
        public IntPtr recips;
        public int fileCount;
        public IntPtr files;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    struct MapiFileDescA
    {
        public int reserved;
        public int flags;
        public int position;
        public string pathName;
        public string fileName;
        public IntPtr fileType;
    }

    const int MAPI_LOGON_UI = 0x1;
    const int MAPI_DIALOG = 0x8;
    const int MAPI_USER_ABORT = 1;
    const int MAPI_E_NOT_SUPPORTED = 26;

    static int Mail(string path, string subject)
    {
        string full = Path.GetFullPath(path);
        string name = Path.GetFileName(full);
        int rc;
        try
        {
            rc = SendW(full, name, subject); // Unicode (Windows 8+ y clientes modernos)
        }
        catch (EntryPointNotFoundException)
        {
            rc = SendA(full, name, subject);
        }
        catch (DllNotFoundException)
        {
            return Reply(false, "sin-cliente", "No hay ningún programa de correo configurado.");
        }
        if (rc == MAPI_E_NOT_SUPPORTED) rc = SendA(full, name, subject); // algunos clientes solo tienen la versión ANSI
        if (rc == 0) return Reply(true);
        if (rc == MAPI_USER_ABORT) return Reply(false, "cancelado", "Se canceló el correo.");
        return Reply(false, "sin-cliente", "El programa de correo predeterminado no admite enviar archivos desde otras aplicaciones (código " + rc + ").");
    }

    static int SendW(string full, string name, string subject)
    {
        var file = new MapiFileDescW { position = -1, pathName = full, fileName = name };
        IntPtr p = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(MapiFileDescW)));
        try
        {
            Marshal.StructureToPtr(file, p, false);
            var msg = new MapiMessageW { subject = subject, noteText = "", fileCount = 1, files = p };
            return MAPISendMailW(IntPtr.Zero, IntPtr.Zero, msg, MAPI_DIALOG | MAPI_LOGON_UI, 0);
        }
        finally
        {
            Marshal.DestroyStructure(p, typeof(MapiFileDescW));
            Marshal.FreeHGlobal(p);
        }
    }

    static int SendA(string full, string name, string subject)
    {
        var file = new MapiFileDescA { position = -1, pathName = full, fileName = name };
        IntPtr p = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(MapiFileDescA)));
        try
        {
            Marshal.StructureToPtr(file, p, false);
            var msg = new MapiMessageA { subject = subject, noteText = "", fileCount = 1, files = p };
            return MAPISendMailA(IntPtr.Zero, IntPtr.Zero, msg, MAPI_DIALOG | MAPI_LOGON_UI, 0);
        }
        finally
        {
            Marshal.DestroyStructure(p, typeof(MapiFileDescA));
            Marshal.FreeHGlobal(p);
        }
    }

    // --- Respuesta: una línea JSON ----------------------------------------------------------------------------------------
    static string Json(string s)
    {
        if (s == null) return "null";
        var b = new System.Text.StringBuilder("\"");
        foreach (char c in s)
        {
            if (c == '"' || c == '\\') b.Append('\\').Append(c);
            else if (c < 0x20) b.AppendFormat("\\u{0:x4}", (int)c);
            else b.Append(c);
        }
        return b.Append('"').ToString();
    }

    static int Reply(bool ok, string code = null, string message = null, string extra = null)
    {
        var o = Console.OpenStandardOutput();
        var line = "{\"ok\":" + (ok ? "true" : "false") + (code != null ? ",\"code\":" + Json(code) : "") +
            (message != null ? ",\"message\":" + Json(message) : "") + (extra != null ? "," + extra : "") + "}\n";
        var bytes = System.Text.Encoding.UTF8.GetBytes(line);
        o.Write(bytes, 0, bytes.Length);
        o.Flush();
        return ok ? 0 : 1;
    }
}
