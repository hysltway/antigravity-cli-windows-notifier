#!/usr/bin/env node
const { execFile } = require('child_process');

/**
 * Hook de Alerta para Windows (Perguntas e Permissões)
 */

const SHOW_ICON = false;

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
    try {
        if (!input.trim()) {
            process.stdout.write(JSON.stringify({ decision: "allow" }));
            return;
        }

        const data = JSON.parse(input);
        const targetPath = `${data.transcriptPath || ''} ${data.artifactDirectoryPath || ''}`;
        if (targetPath && !targetPath.includes('antigravity-cli')) {
            process.stdout.write(JSON.stringify({ decision: "allow" }));
            return;
        }

        const toolName = data.toolCall?.name || data.tool_name || '';
        const toolArgs = data.toolCall?.args || data.tool_input || {};
        const notificationType = data.notification_type; 
        
        let notificationTitle = "";
        let notificationText = "";

        // Se for o pedido de permissão genérico para ask_user/ask_question, ignora (para não duplicar)
        if (notificationType === 'ToolPermission' && (toolName === 'ask_user' || toolName === 'ask_question')) {
            process.stdout.write(JSON.stringify({ decision: "allow" }));
            return;
        }

        const path = require('path');
        const os = require('os');
        const fs = require('fs');
        const localLogo = path.resolve(__dirname, '..', 'assets', 'antigravity-logo.png');
        const fallbackLogo = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'assets', 'antigravity-logo.png');
        const logoPath = fs.existsSync(localLogo) ? localLogo : fallbackLogo;

        // Pergunta direta ao usuário (ask_question ou ask_user)
        if (toolName === 'ask_user' || toolName === 'ask_question') {
            let question = '';
            if (toolArgs.questions && Array.isArray(toolArgs.questions) && toolArgs.questions.length > 0) {
                question = toolArgs.questions[0].question || '';
            } else if (typeof toolArgs.question === 'string') {
                question = toolArgs.question;
            }
            notificationTitle = "Antigravity CLI: Question";
            notificationText = (question || "Waiting for your input").trim()
                .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                .replace(/`([^`]+)`/g, '$1')
                .replace(/\s+/g, ' ')
                .substring(0, 100);
        } 
        // Pedido de permissão para outras ferramentas
        else if (notificationType === 'ToolPermission') {
            notificationTitle = "Antigravity CLI: Permission";
            notificationText = `Do you want to execute ${toolName || 'tool'}?`;
        }
        else {
            process.stdout.write(JSON.stringify({ decision: "allow" }));
            return;
        }

        const iconTag = SHOW_ICON ? `<image placement="appLogoOverride" src="file:///${logoPath.replace(/\\/g, '/')}" />` : '';

        const psScript = `
            [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
            [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
            $title = "${notificationTitle.replace(/"/g, '`"')}"
            $text = "${notificationText.replace(/"/g, '`"')}"
            $template = @"
<toast duration="long">
    <visual>
        <binding template="ToastGeneric">
            ${iconTag}
            <text>$title</text>
            <text>$text</text>
        </binding>
    </visual>
    <audio src="ms-winsoundevent:Notification.SMS" />
</toast>
"@
            $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
            $xml.LoadXml($template)
            $toast = New-Object Windows.UI.Notifications.ToastNotification $xml
            # AppId oficial do PowerShell
            $appId = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe"
            [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
        `;

        execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], () => {
            process.stdout.write(JSON.stringify({ decision: "allow" }));
        });

    } catch (e) {
        process.stdout.write(JSON.stringify({ decision: "allow" }));
    }
});
