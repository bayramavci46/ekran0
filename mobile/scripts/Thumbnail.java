// Makes a small JPEG of a screenshot, for the device check (smoke-device.mjs) on Linux, where
// the JDK that builds the Android app is at hand and image tools may not be:
//   java scripts/Thumbnail.java smoke-android.png smoke-android-small.jpg 420
import java.awt.Graphics2D;
import java.awt.Image;
import java.awt.image.BufferedImage;
import java.io.File;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageOutputStream;

public class Thumbnail {
    public static void main(String[] args) throws Exception {
        System.setProperty("java.awt.headless", "true");
        BufferedImage source = ImageIO.read(new File(args[0]));
        int height = Integer.parseInt(args[2]);
        int width = Math.max(1, Math.round((float) source.getWidth() * height / source.getHeight()));
        BufferedImage small = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = small.createGraphics();
        g.drawImage(source.getScaledInstance(width, height, Image.SCALE_AREA_AVERAGING), 0, 0, null);
        g.dispose();

        ImageWriter writer = ImageIO.getImageWritersByFormatName("jpeg").next();
        ImageWriteParam options = writer.getDefaultWriteParam();
        options.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
        options.setCompressionQuality(0.55f);
        try (ImageOutputStream out = ImageIO.createImageOutputStream(new File(args[1]))) {
            writer.setOutput(out);
            writer.write(null, new IIOImage(small, null, null), options);
        }
        writer.dispose();
    }
}
