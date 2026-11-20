// SpiderPDF.com: lanzador de consola, junto a SpiderPDF.exe en la carpeta de instalación (como devenv.com).
// SpiderPDF.exe es una aplicación de ventanas: en una terminal (cmd, PowerShell) la orden vuelve al instante, sin
// esperar ni dar el código de salida. Escribiendo «SpiderPDF …» la terminal elige antes el .com (PATHEXT), que lanza
// SpiderPDF.exe con los mismos argumentos, comparte la consola (salida y errores), espera y devuelve su código.
// Solo espera con «--html-a-pdf»; con otra cosa (abrir un PDF) lanza la app y vuelve.
// Lo compila build/helper/build.cjs con el csc.exe de .NET Framework 4.8; electron-builder lo copia (extraFiles).
using System;
using System.Diagnostics;
using System.IO;

[assembly: System.Reflection.AssemblyTitle("SpiderPDF")]
[assembly: System.Reflection.AssemblyProduct("SpiderPDF")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]

static class SpiderPdfCli
{
    static int Main(string[] args)
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string exe = Path.Combine(dir, "SpiderPDF.exe");
        if (!File.Exists(exe))
        {
            Console.Error.WriteLine("SpiderPDF.exe not found: " + exe);
            return 3;
        }
        var start = new ProcessStartInfo(exe, RawArguments())
        {
            UseShellExecute = false, // hereda la consola: lo que escribe SpiderPDF sale aquí
            WorkingDirectory = Environment.CurrentDirectory, // las rutas relativas, respecto a la carpeta actual
        };
        // VS Code la define en sus terminales (y Claude Code la hereda): convertiría SpiderPDF.exe en Node. La app
        // empaquetada ya la ignora (fuse runAsNode desactivado); se quita también aquí por si acaso.
        start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
        bool wait = Array.IndexOf(args, "--html-a-pdf") >= 0;
        using (Process p = Process.Start(start))
        {
            if (!wait) return 0;
            p.WaitForExit();
            return p.ExitCode;
        }
    }

    /// Los argumentos tal como llegaron (con sus comillas), sin el nombre del programa.
    static string RawArguments()
    {
        string line = Environment.CommandLine;
        int i = 0;
        if (line.StartsWith("\""))
        {
            i = line.IndexOf('"', 1);
            i = i < 0 ? line.Length : i + 1;
        }
        else
        {
            while (i < line.Length && !char.IsWhiteSpace(line[i])) i++;
        }
        return line.Substring(i).TrimStart();
    }
}
